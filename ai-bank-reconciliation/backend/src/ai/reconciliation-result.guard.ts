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
 * Loads a reconciliation RESULT from `:id` and verifies the caller belongs
 * to its run's company. Unknown and foreign results both yield 404.
 */
@Injectable()
export class ReconciliationResultGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const resultId = request.params['id'];
    const userId = request.user?.id;
    if (!resultId || !userId) {
      throw new NotFoundException('Reconciliation result not found');
    }
    const result = await this.prisma.reconciliationResult.findUnique({
      where: { id: resultId },
      include: { run: true },
    });
    if (!result) {
      throw new NotFoundException('Reconciliation result not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: result.run.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Reconciliation result not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId: result.run.companyId,
      membershipRole: membership.role,
    };
    return true;
  }
}
