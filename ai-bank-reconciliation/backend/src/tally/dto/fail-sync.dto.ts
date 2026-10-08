import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FailSyncDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  errorMessage!: string;
}
