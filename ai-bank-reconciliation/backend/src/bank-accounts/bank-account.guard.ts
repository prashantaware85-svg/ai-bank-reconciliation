import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface GuardUser {
  id: string;
  roles?: string[];
  companyId?: string;
  membershipRole?: string;
  [key: string]: unknown;
}

/**
 * Loads a bank account from `:id` or `:bankAccountId` and verifies the
 * caller belongs to the account's company. Attaches roles + bankAccount.
 * Unknown account and foreign account both yield 404 (no IDOR oracle).
 */
@Injectable()
export class BankAccountGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const bankAccountId =
      request.params['bankAccountId'] ?? request.params['id'];
    const userId = request.user?.id;
    if (!bankAccountId || !userId) {
      throw new NotFoundException('Bank account not found');
    }
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: account.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Bank account not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId: account.companyId,
      membershipRole: membership.role,
    };
    (request as { bankAccount?: typeof account }).bankAccount = account;
    return true;
  }
}
