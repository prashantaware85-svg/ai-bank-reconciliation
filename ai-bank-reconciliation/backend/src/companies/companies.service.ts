import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddMemberDto } from './dto/add-member.dto.js';
import type { CreateCompanyDto } from './dto/create-company.dto.js';
import type { UpdateCompanyDto } from './dto/update-company.dto.js';
import type { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';

const OWNER_ONLY = 'Only the company owner can perform this action';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  );
}

/**
 * Company + membership management. Every method takes the caller's `userId`
 * (from the JWT) and re-verifies membership — the HTTP guards are the first
 * layer, these checks are the second, so tenant isolation never depends on
 * routing alone.
 */
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Company not found');
    }
    return membership;
  }

  private async requireOwner(userId: string, companyId: string) {
    const membership = await this.requireMembership(userId, companyId);
    if (membership.role !== CompanyRole.OWNER) {
      throw new ForbiddenException(OWNER_ONLY);
    }
    return membership;
  }

  async create(userId: string, dto: CreateCompanyDto) {
    try {
      const { company, role } = await this.prisma.$transaction(
        async (tx) => {
          const company = await tx.company.create({
            data: {
              companyName: dto.companyName.trim(),
              legalName: dto.legalName?.trim() || undefined,
              gstin: dto.gstin || undefined,
              pan: dto.pan || undefined,
              financialYear: dto.financialYear.trim(),
              currency: dto.currency?.trim() || 'INR',
              timezone: dto.timezone?.trim() || 'Asia/Kolkata',
            },
          });
          const membership = await tx.companyUser.create({
            data: {
              userId,
              companyId: company.id,
              role: CompanyRole.OWNER,
            },
          });
          return { company, role: membership.role };
        },
      );
      return { ...company, role };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('GSTIN already registered');
      }
      throw error;
    }
  }

  async list(userId: string) {
    const memberships = await this.prisma.companyUser.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.company, role: m.role }));
  }

  async getById(userId: string, companyId: string) {
    const membership = await this.requireMembership(userId, companyId);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return { ...company, role: membership.role };
  }

  async update(userId: string, companyId: string, dto: UpdateCompanyDto) {
    await this.requireOwner(userId, companyId);
    try {
      const company = await this.prisma.company.update({
        where: { id: companyId },
        data: {
          companyName: dto.companyName?.trim(),
          legalName: dto.legalName?.trim(),
          gstin: dto.gstin,
          pan: dto.pan,
          financialYear: dto.financialYear?.trim(),
          currency: dto.currency?.trim(),
          timezone: dto.timezone?.trim(),
        },
      });
      return { ...company, role: CompanyRole.OWNER };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('GSTIN already registered');
      }
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Company not found');
      }
      throw error;
    }
  }

  async listMembers(userId: string, companyId: string) {
    await this.requireMembership(userId, companyId);
    const members = await this.prisma.companyUser.findMany({
      where: { companyId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
      user: m.user,
    }));
  }

  async addMember(userId: string, companyId: string, dto: AddMemberDto) {
    await this.requireOwner(userId, companyId);
    if (dto.role === CompanyRole.OWNER) {
      throw new BadRequestException('Owner role cannot be assigned');
    }
    const email = dto.email.trim().toLowerCase();
    const target = await this.prisma.user.findUnique({ where: { email } });
    if (!target || !target.isActive) {
      throw new NotFoundException('User not found');
    }
    const existing = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId: target.id, companyId } },
    });
    if (existing) {
      throw new ConflictException('User is already a member');
    }
    const membership = await this.prisma.companyUser.create({
      data: { userId: target.id, companyId, role: dto.role },
    });
    return {
      userId: target.id,
      name: target.name,
      email: target.email,
      role: membership.role,
    };
  }

  async changeRole(
    userId: string,
    companyId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.requireOwner(userId, companyId);
    if (dto.role === CompanyRole.OWNER) {
      throw new BadRequestException('Owner role cannot be assigned');
    }
    const target = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === CompanyRole.OWNER) {
      throw new ForbiddenException('The company owner cannot be demoted');
    }
    return this.prisma.companyUser.update({
      where: { id: target.id },
      data: { role: dto.role },
    });
  }

  async removeMember(
    userId: string,
    companyId: string,
    targetUserId: string,
  ) {
    const mine = await this.requireMembership(userId, companyId);

    if (targetUserId === userId) {
      if (mine.role === CompanyRole.OWNER) {
        throw new ForbiddenException(
          'The company owner cannot leave the company',
        );
      }
      await this.prisma.companyUser.delete({ where: { id: mine.id } });
      return { left: true };
    }

    if (mine.role !== CompanyRole.OWNER) {
      throw new ForbiddenException(OWNER_ONLY);
    }
    const target = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === CompanyRole.OWNER) {
      throw new ForbiddenException('The company owner cannot be removed');
    }
    await this.prisma.companyUser.delete({ where: { id: target.id } });
    return { removed: true };
  }
}
