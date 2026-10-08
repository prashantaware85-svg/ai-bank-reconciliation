import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TransactionDirection } from '../../generated/prisma/client.js';

export class TallyTxnDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  voucherId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  voucherNo?: string;

  @IsString()
  @MaxLength(30)
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ledger?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankLedger?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  voucherType?: string;

  @IsEnum(TransactionDirection, { message: 'direction must be DEBIT or CREDIT' })
  direction!: TransactionDirection;

  @IsString()
  @MaxLength(30)
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  narration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  party?: string;
}

export class IngestSyncDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => TallyTxnDto)
  transactions!: TallyTxnDto[];

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}
