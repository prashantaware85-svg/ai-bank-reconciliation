import { IsOptional, IsUUID } from 'class-validator';

/** Filters for GET /bank-imports (single DTO so no query key is stripped). */
export class ListImportsQueryDto {
  @IsUUID('4', { message: 'companyId must be a valid UUID' })
  companyId!: string;

  @IsOptional()
  @IsUUID('4', { message: 'bankAccountId must be a valid UUID' })
  bankAccountId?: string;
}
