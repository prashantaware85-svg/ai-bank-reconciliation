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
 * Loads a reconciliation run from `:id` and verifies the caller belongs to
 * its company. Unknown and foreign runs both yield 404.
 */
@Injectable()
export class ReconciliationRunGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const runId = request.params['id'];
    const userId = request.user?.id;
    if (!runId || !userId) {
      throw new NotFoundException('Reconciliation run not found');
    }
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Reconciliation run not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId: run.companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Reconciliation run not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId: run.companyId,
      membershipRole: membership.role,
    };
    return true;
  }
}
