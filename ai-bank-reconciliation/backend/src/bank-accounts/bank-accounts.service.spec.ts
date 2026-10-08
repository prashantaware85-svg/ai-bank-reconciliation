import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { CreateBankAccountDto } from './dto/create-bank-account.dto.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const account = {
  id: ACCOUNT_ID,
  companyId: COMPANY_ID,
  bankName: 'HDFC Bank',
  accountName: 'Current A/c',
  accountNumberMasked: 'XXXX1234',
  ifsc: 'HDFC0001234',
  currency: 'INR',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    bankAccount: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function membership(role: CompanyRole) {
  return { id: 'm-1', userId: USER_ID, companyId: COMPANY_ID, role };
}

describe('BankAccountsService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
  });

  const service = () =>
    new BankAccountsService(prisma as unknown as PrismaService);

  const validDto = () =>
    Object.assign(new CreateBankAccountDto(), {
      bankName: 'HDFC Bank',
      accountName: 'Current A/c',
      accountNumberMasked: 'XXXX1234',
      ifsc: 'HDFC0001234',
    });

  it('1. creates a bank account with defaults', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.bankAccount.create.mockResolvedValue(account);

    const result = await service().create(USER_ID, COMPANY_ID, validDto());

    expect(prisma.bankAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          currency: 'INR',
          isActive: true,
        }),
      }),
    );
    expect(result.bankName).toBe('HDFC Bank');
  });

  it('2. rejects invalid IFSC and duplicate account names', async () => {
    const dto = Object.assign(new CreateBankAccountDto(), {
      bankName: 'HDFC Bank',
      accountName: 'X',
      accountNumberMasked: 'XXXX1',
      ifsc: 'BAD',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'ifsc')).toBe(true);

    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.bankAccount.create.mockRejectedValue({ code: 'P2002' });
    await expect(service().create(USER_ID, COMPANY_ID, validDto())).rejects.toThrow(
      'An account with this name already exists',
    );
  });

  it('3. rejects cross-company access', async () => {
    prisma.bankAccount.findUnique.mockResolvedValue({
      ...account,
      companyId: OTHER_ID,
    });
    prisma.companyUser.findUnique.mockResolvedValue(null);

    await expect(service().getById(USER_ID, ACCOUNT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('4. OWNER can create and update', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.bankAccount.create.mockResolvedValue(account);
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.bankAccount.update.mockResolvedValue({
      ...account,
      bankName: 'ICICI Bank',
    });

    await service().create(USER_ID, COMPANY_ID, validDto());
    const updated = await service().update(USER_ID, ACCOUNT_ID, {
      bankName: 'ICICI Bank',
    });
    expect(updated.bankName).toBe('ICICI Bank');
  });

  it('5. ACCOUNTANT can create and update', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('ACCOUNTANT'));
    prisma.bankAccount.create.mockResolvedValue(account);
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.bankAccount.update.mockResolvedValue(account);

    await expect(
      service().create(USER_ID, COMPANY_ID, validDto()),
    ).resolves.toBeDefined();
    await expect(
      service().update(USER_ID, ACCOUNT_ID, { bankName: 'X' }),
    ).resolves.toBeDefined();
  });

  it('6. REVIEWER is read-only', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('REVIEWER'));
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.bankAccount.findMany.mockResolvedValue([account]);

    await expect(service().list(USER_ID, COMPANY_ID)).resolves.toHaveLength(1);
    await expect(service().getById(USER_ID, ACCOUNT_ID)).resolves.toBeDefined();
    await expect(
      service().create(USER_ID, COMPANY_ID, validDto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service().update(USER_ID, ACCOUNT_ID, { bankName: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('7. VIEWER is read-only', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('VIEWER'));
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.bankAccount.findMany.mockResolvedValue([account]);

    await expect(service().list(USER_ID, COMPANY_ID)).resolves.toHaveLength(1);
    await expect(
      service().create(USER_ID, COMPANY_ID, validDto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service().update(USER_ID, ACCOUNT_ID, { bankName: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
