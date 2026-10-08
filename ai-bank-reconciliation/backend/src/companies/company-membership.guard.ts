import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GuardUser {
  id: string;
  roles?: string[];
  companyId?: string;
  membershipRole?: string;
  [key: string]: unknown;
}

/**
 * Company membership guard (tenant isolation).
 *
 * - Routes without an `:id` param pass through (auth-only collection routes).
 * - For `:id` routes it loads the caller's `CompanyUser` membership and
 *   attaches `roles: [role]` so the existing `RolesGuard` can enforce
 *   `@Roles(...)` on top.
 * - Missing membership AND missing company both yield 404, so tenant
 *   existence is never leaked across tenants (no IDOR oracle).
 */
@Injectable()
export class CompanyMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string | undefined>;
      user?: GuardUser;
    }>();

    const companyId = request.params['id'];
    if (!companyId) {
      return true;
    }
    const userId = request.user?.id;
    if (!userId || !UUID_PATTERN.test(companyId)) {
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
