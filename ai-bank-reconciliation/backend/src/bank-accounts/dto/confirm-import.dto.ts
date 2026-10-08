import { Transform } from 'class-transformer';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

/**
 * Confirm a previewed import. The file is re-uploaded with the (possibly
 * corrected) mapping so the server stays stateless — no staging store.
 */
export class ConfirmImportDto {
  @IsOptional()
  @IsObject({ message: 'mapping must be an object' })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    }
    return value;
  })
  mapping?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true' ? true : value === false || value === 'false' ? false : value,
  )
  allowDuplicate?: boolean;
}
