import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MatchType, ReconciliationStatus } from '../../generated/prisma/client.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ResultsQueryDto {
  @IsOptional()
  @IsEnum(ReconciliationStatus)
  status?: ReconciliationStatus;

  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reviewStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  risk?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  aiClassification?: string;

  @IsOptional()
  @IsUUID('4')
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  party?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  minAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  maxAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  toDate?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(0)
  offset?: number;
}
