import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** GSTIN: 2-digit state code + 10-char PAN + entity/checksum chars. */
export const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

/** PAN: 5 letters + 4 digits + 1 letter. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName!: string;

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

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  financialYear!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;
}
