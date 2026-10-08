import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';
import { CompanyRole } from '../../generated/prisma/client.js';

export class AddMemberDto {
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsEnum(CompanyRole, { message: 'Role must be a valid company role' })
  role!: CompanyRole;
}
