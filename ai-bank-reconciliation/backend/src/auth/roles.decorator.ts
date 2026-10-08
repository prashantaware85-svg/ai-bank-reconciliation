import { SetMetadata } from '@nestjs/common';

/** Company-level roles (mirrors the Prisma `CompanyRole` enum). */
export type AppRole = 'OWNER' | 'ACCOUNTANT' | 'REVIEWER' | 'VIEWER';

export const ROLES_KEY = 'roles';

/**
 * Declares roles required for a route. Combine with `JwtAuthGuard`:
 * `@UseGuards(JwtAuthGuard, RolesGuard)`.
 */
export const Roles = (...roles: AppRole[]) =>
  SetMetadata(ROLES_KEY, roles);
