import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class StartSyncDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tallyCompany!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  bankLedger!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'toDate must be YYYY-MM-DD' })
  toDate?: string;
}
