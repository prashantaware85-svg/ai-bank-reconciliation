import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { GSTIN_PATTERN, PAN_PATTERN } from './create-company.dto.js';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Transform(upper)
  @Matches(GSTIN_PATTERN, { message: 'GSTIN format is invalid' })
  gstin?: string;

  @IsOptional()
  @IsString()
  @Transform(upper)
  @Matches(PAN_PATTERN, { message: 'PAN format is invalid' })
  pan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  financialYear?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;
}
