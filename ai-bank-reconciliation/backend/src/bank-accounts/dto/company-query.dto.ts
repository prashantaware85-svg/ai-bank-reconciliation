import { IsUUID } from 'class-validator';

/** Tenant scope for collection routes: the company being acted upon. */
export class CompanyQueryDto {
  @IsUUID('4', { message: 'companyId must be a valid UUID' })
  companyId!: string;
}
