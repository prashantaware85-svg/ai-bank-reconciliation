import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type AppRole } from './roles.decorator.js';

/**
 * Role guard for company-scoped routes (Step 4: company authorization live).
 *
 * - Routes without `@Roles(...)` are allowed through (auth itself is
 *   enforced by `JwtAuthGuard`, tenant isolation by `CompanyMembershipGuard`
 *   when both guards are applied).
 * - Routes with `@Roles(...)` require `request.user.roles` (populated by
 *   `CompanyMembershipGuard` from `CompanyUser`) to contain at least one
 *   required role. Missing roles deny by default (secure default).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { roles?: string[] } }>();
    const userRoles = request.user?.roles ?? [];
    if (userRoles.some((role) => required.includes(role as AppRole))) {
      return true;
    }
    throw new ForbiddenException('Insufficient permissions');
  }
}
