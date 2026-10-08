import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** Filters for GET /reconciliation/results (run-scoped). */
export class CreateAliasDto {
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  canonicalParty!: string;

  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  alias!: string;

  @IsOptional()
  @IsEnum(['BANK_NARRATION', 'TALLY_PARTY'])
  aliasType?: 'BANK_NARRATION' | 'TALLY_PARTY';
}
