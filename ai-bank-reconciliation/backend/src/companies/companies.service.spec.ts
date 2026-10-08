import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CompanyRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CompaniesService } from './companies.service.js';
import { CompanyMembershipGuard } from './company-membership.guard.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const OUTSIDER_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COMPANY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const company = {
  id: COMPANY_ID,
  companyName: 'ABC Traders',
  legalName: 'ABC Traders Private Limited',
  gstin: '27ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  financialYear: '2026-27',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const ownerMembership = {
  id: 'm-owner',
  userId: OWNER_ID,
  companyId: COMPANY_ID,
  role: CompanyRole.OWNER,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  const tx = {
    company: { create: vi.fn() },
    companyUser: { create: vi.fn() },
  };
  return {
    tx,
    company: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    companyUser: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    ),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock): CompaniesService {
  return new CompaniesService(prisma as unknown as PrismaService);
}

function membershipFor(role: CompanyRole, userId = MEMBER_ID) {
  return { ...ownerMembership, id: `m-${role}`, userId, role };
}

function httpContext(request: unknown, handler = {}) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => ({}),
  } as never;
}

describe('CompaniesService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
  });

  it('1. authenticated user can create a company', async () => {
    prisma.tx.company.create.mockResolvedValue(company);
    prisma.tx.companyUser.create.mockResolvedValue(ownerMembership);

    const result = await makeService(prisma).create(
      OWNER_ID,
      Object.assign(new CreateCompanyDto(), {
        companyName: 'ABC Traders',
        financialYear: '2026-27',
      }),
    );

    expect(result.companyName).toBe('ABC Traders');
    expect(result.role).toBe(CompanyRole.OWNER);
  });

  it('2. unauthenticated request cannot reach company creation (401)', async () => {
    const guard = new JwtAuthGuard(
      new JwtService({}),
      {
        getOrThrow: () => 'test-secret',
      } as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    await expect(
      guard.canActivate(httpContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('3. creator automatically becomes OWNER', async () => {
    prisma.tx.company.create.mockResolvedValue(company);
    prisma.tx.companyUser.create.mockResolvedValue(ownerMembership);

    await makeService(prisma).create(
      OWNER_ID,
      Object.assign(new CreateCompanyDto(), {
        companyName: 'ABC Traders',
        financialYear: '2026-27',
      }),
    );

    expect(prisma.tx.companyUser.create).toHaveBeenCalledWith({
      data: { userId: OWNER_ID, companyId: COMPANY_ID, role: 'OWNER' },
    });
  });

  it('4. user lists only companies they belong to', async () => {
    prisma.companyUser.findMany.mockResolvedValue([
      { ...ownerMembership, company },
    ]);

    const result = await makeService(prisma).list(OWNER_ID);

    expect(prisma.companyUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OWNER_ID } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe(CompanyRole.OWNER);
  });

  it("5. user cannot access another company's data (404)", async () => {
    prisma.companyUser.findUnique.mockResolvedValue(null);

    await expect(
      makeService(prisma).getById(OUTSIDER_ID, COMPANY_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('6. OWNER can update the company', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(ownerMembership);
    prisma.company.update.mockResolvedValue({
      ...company,
      companyName: 'ABC New Name',
    });

    const result = await makeService(prisma).update(OWNER_ID, COMPANY_ID, {
      companyName: 'ABC New Name',
    });

    expect(result.companyName).toBe('ABC New Name');
  });

  it.each([
    CompanyRole.ACCOUNTANT,
    CompanyRole.REVIEWER,
    CompanyRole.VIEWER,
  ])('7-9. %s cannot update the company (403)', async (role) => {
    prisma.companyUser.findUnique.mockResolvedValue(membershipFor(role));

    await expect(
      makeService(prisma).update(MEMBER_ID, COMPANY_ID, {
        companyName: 'Hijacked',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('10. OWNER can add a member', async () => {
    prisma.companyUser.findUnique.mockResolvedValueOnce(ownerMembership);
    prisma.user.findUnique.mockResolvedValue({
      id: MEMBER_ID,
      name: 'Acc',
      email: 'acc@example.com',
      isActive: true,
    });
    prisma.companyUser.findUnique.mockResolvedValueOnce(null);
    prisma.companyUser.create.mockResolvedValue(membershipFor('ACCOUNTANT'));

    const result = await makeService(prisma).addMember(
      OWNER_ID,
      COMPANY_ID,
      Object.assign(new AddMemberDto(), {
        email: 'acc@example.com',
        role: 'ACCOUNTANT',
      }),
    );

    expect(result.role).toBe(CompanyRole.ACCOUNTANT);
  });

  it('11. duplicate membership is rejected (409)', async () => {
    prisma.companyUser.findUnique.mockResolvedValueOnce(ownerMembership);
    prisma.user.findUnique.mockResolvedValue({
      id: MEMBER_ID,
      name: 'Acc',
      email: 'acc@example.com',
      isActive: true,
    });
    prisma.companyUser.findUnique.mockResolvedValueOnce(
      membershipFor('ACCOUNTANT'),
    );

    await expect(
      makeService(prisma).addMember(
        OWNER_ID,
        COMPANY_ID,
        Object.assign(new AddMemberDto(), {
          email: 'acc@example.com',
          role: 'ACCOUNTANT',
        }),
      ),
    ).rejects.toThrow('User is already a member');
  });

  it('12. invalid role is rejected by DTO validation', async () => {
    const dto = Object.assign(new AddMemberDto(), {
      email: 'acc@example.com',
      role: 'SUPERADMIN',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('13. OWNER can change a member role', async () => {
    prisma.companyUser.findUnique.mockResolvedValueOnce(ownerMembership);
    prisma.companyUser.findUnique.mockResolvedValueOnce(
      membershipFor('ACCOUNTANT'),
    );
    prisma.companyUser.update.mockResolvedValue(membershipFor('REVIEWER'));

    const result = await makeService(prisma).changeRole(
      OWNER_ID,
      COMPANY_ID,
      MEMBER_ID,
      { role: CompanyRole.REVIEWER },
    );

    expect(result.role).toBe(CompanyRole.REVIEWER);
  });

  it('14. non-owner cannot change roles (403)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(
      membershipFor('ACCOUNTANT'),
    );

    await expect(
      makeService(prisma).changeRole(MEMBER_ID, COMPANY_ID, OWNER_ID, {
        role: CompanyRole.VIEWER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('15. OWNER cannot be removed by another member (403)', async () => {
    prisma.companyUser.findUnique.mockResolvedValueOnce(ownerMembership);
    prisma.companyUser.findUnique.mockResolvedValueOnce({
      ...ownerMembership,
      id: 'm-owner-2',
      userId: '99999999-9999-4999-8999-999999999999',
    });

    await expect(
      makeService(prisma).removeMember(
        OWNER_ID,
        COMPANY_ID,
        '99999999-9999-4999-8999-999999999999',
      ),
    ).rejects.toThrow('The company owner cannot be removed');
  });

  it('16. non-owner member can leave the company', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(
      membershipFor('ACCOUNTANT'),
    );
    prisma.companyUser.delete.mockResolvedValue(membershipFor('ACCOUNTANT'));

    const result = await makeService(prisma).removeMember(
      MEMBER_ID,
      COMPANY_ID,
      MEMBER_ID,
    );

    expect(result).toEqual({ left: true });
    expect(prisma.companyUser.delete).toHaveBeenCalled();
  });

  it('owner cannot leave the company (403)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(ownerMembership);

    await expect(
      makeService(prisma).removeMember(OWNER_ID, COMPANY_ID, OWNER_ID),
    ).rejects.toThrow('The company owner cannot leave');
  });

  it('17. cross-company access via guard returns 404', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(null);
    const guard = new CompanyMembershipGuard(
      prisma as unknown as PrismaService,
    );

    await expect(
      guard.canActivate(
        httpContext({
          params: { id: OTHER_COMPANY_ID },
          user: { id: OUTSIDER_ID },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('guard attaches owner role for members (RolesGuard composition)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(ownerMembership);
    const guard = new CompanyMembershipGuard(
      prisma as unknown as PrismaService,
    );
    const request: {
      params: Record<string, string>;
      user: Record<string, unknown>;
    } = { params: { id: COMPANY_ID }, user: { id: OWNER_ID } };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);

    const rolesGuard = new RolesGuard({
      getAllAndOverride: () => ['OWNER'],
    } as unknown as Reflector);
    expect(rolesGuard.canActivate(httpContext(request))).toBe(true);

    const viewerRequest = {
      params: { id: COMPANY_ID },
      user: { id: MEMBER_ID, roles: ['VIEWER'] },
    };
    expect(() =>
      rolesGuard.canActivate(httpContext(viewerRequest)),
    ).toThrow('Insufficient permissions');
    expect(ROLES_KEY).toBe('roles');
  });

  it('invalid GSTIN and PAN are rejected by DTO validation', async () => {
    const dto = Object.assign(new CreateCompanyDto(), {
      companyName: 'ABC',
      financialYear: '2026-27',
      gstin: 'BAD',
      pan: 'BAD',
    });
    const errors = await validate(dto);
    const props = errors.map((e) => e.property);
    expect(props).toContain('gstin');
    expect(props).toContain('pan');
  });
});
