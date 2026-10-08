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
 * Scope guard for `?companyId=` collection routes. Verifies the caller
 * belongs to the company and attaches `roles: [role]` for `RolesGuard`.
 * Missing membership yields 404 (no cross-tenant oracle).
 */
@Injectable()
export class CompanyQueryGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      query: Record<string, string | undefined>;
      user?: GuardUser;
    }>();
    const companyId = request.query['companyId'];
    const userId = request.user?.id;
    if (!companyId || !userId) {
      throw new NotFoundException('Company not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Company not found');
    }
    request.user = {
      ...request.user,
      id: userId,
      roles: [membership.role],
      companyId,
      membershipRole: membership.role,
    };
    return true;
  }
}
