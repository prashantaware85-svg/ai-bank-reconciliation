import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  accountName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  accountNumberMasked!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(IFSC_PATTERN, { message: 'IFSC format is invalid' })
  ifsc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
