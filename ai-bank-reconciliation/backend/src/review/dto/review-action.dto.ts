import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ReviewActionType } from '../../generated/prisma/client.js';

export class ReviewActionDto {
  // class-validator decorator is required — without it the global
  // whitelist strips `action` and forbidNonWhitelisted rejects the body.
  @IsEnum(ReviewActionType, { message: 'Invalid review action' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  action!: ReviewActionType;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reviewVersion?: number;
}
