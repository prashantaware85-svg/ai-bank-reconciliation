import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRunDto {
  @IsUUID('4')
  bankAccountId!: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(0)
  @Max(30)
  dateToleranceDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankLedger?: string;
}
