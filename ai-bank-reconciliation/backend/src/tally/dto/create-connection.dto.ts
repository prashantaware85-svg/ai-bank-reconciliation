import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}
