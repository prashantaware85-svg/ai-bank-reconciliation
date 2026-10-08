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
 * Loads a Tally connection from `:id` and verifies the caller belongs to
 * its company. Unknown and foreign connections both yield 404.
 */
@Injectable()
export class TallyConnectionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const connectionId = request.params['id'];
    const userId = request.user?.id;
    if (!connectionId || !userId) {
      throw new NotFoundException('Connection not found');
    }
    const connection = await this.prisma.tallyConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: connection.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Connection not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId: connection.companyId,
      membershipRole: membership.role,
    };
    return true;
  }
}
