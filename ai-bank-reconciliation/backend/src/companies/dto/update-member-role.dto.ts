import { IsEnum } from 'class-validator';
import { CompanyRole } from '../../generated/prisma/client.js';

export class UpdateMemberRoleDto {
  @IsEnum(CompanyRole, { message: 'Role must be a valid company role' })
  role!: CompanyRole;
}
