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
 * Loads a Tally sync run from `:syncId` and verifies the caller belongs to
 * its company. Unknown and foreign runs both yield 404.
 */
@Injectable()
export class TallySyncGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const syncId = request.params['syncId'];
    const userId = request.user?.id;
    if (!syncId || !userId) {
      throw new NotFoundException('Sync not found');
    }
    const sync = await this.prisma.tallySync.findUnique({
      where: { id: syncId },
    });
    if (!sync) {
      throw new NotFoundException('Sync not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId: sync.companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Sync not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId: sync.companyId,
      membershipRole: membership.role,
    };
    return true;
  }
}
