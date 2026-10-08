import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateBankAccountDto } from './dto/create-bank-account.dto.js';
import type { UpdateBankAccountDto } from './dto/update-bank-account.dto.js';

const EDITOR_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];

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
 * Bank account CRUD. Tenant isolation is enforced per method (guards are the
 * first layer); write access requires OWNER or ACCOUNTANT.
 */
@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Bank account not found');
    }
    return membership;
  }

  private async requireEditor(userId: string, companyId: string) {
    const membership = await this.requireMembership(userId, companyId);
    if (!EDITOR_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can manage bank accounts',
      );
    }
    return membership;
  }

  async create(
    userId: string,
    companyId: string,
    dto: CreateBankAccountDto,
  ) {
    await this.requireEditor(userId, companyId);
    try {
      return await this.prisma.bankAccount.create({
        data: {
          companyId,
          bankName: dto.bankName.trim(),
          accountName: dto.accountName.trim(),
          accountNumberMasked: dto.accountNumberMasked.trim(),
          ifsc: dto.ifsc,
          currency: dto.currency?.trim() || 'INR',
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'An account with this name already exists',
        );
      }
      throw error;
    }
  }

  async list(userId: string, companyId: string) {
    await this.requireMembership(userId, companyId);
    return this.prisma.bankAccount.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getById(userId: string, id: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }
    await this.requireMembership(userId, account.companyId);
    return account;
  }

  async update(userId: string, id: string, dto: UpdateBankAccountDto) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }
    await this.requireEditor(userId, account.companyId);
    try {
      return await this.prisma.bankAccount.update({
        where: { id },
        data: {
          bankName: dto.bankName?.trim(),
          accountName: dto.accountName?.trim(),
          accountNumberMasked: dto.accountNumberMasked?.trim(),
          ifsc: dto.ifsc,
          currency: dto.currency?.trim(),
          isActive: dto.isActive,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'An account with this name already exists',
        );
      }
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Bank account not found');
      }
      throw error;
    }
  }
}
