import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  validateSync,
} from 'class-validator';
import { plainToInstance, Transform } from 'class-transformer';

/**
 * Production environment validation (Step 12). Runs once at boot via
 * ConfigModule.forRoot({ validate }) and fails fast with a clear message
 * instead of cryptic runtime errors. Secrets are never logged.
 */
export class EnvironmentVariables {
  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, {
    message: 'JWT_SECRET must be at least 32 characters (generate with: openssl rand -hex 32)',
  })
  JWT_SECRET!: string;

  @IsString()
  @MinLength(32, {
    message:
      'JWT_REFRESH_SECRET must be at least 32 characters (generate with: openssl rand -hex 32)',
  })
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string = 'redis://127.0.0.1:6379';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value ?? 3000))
  @IsInt()
  PORT?: number = 3000;

  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string = 'development';

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string = '*';

  @IsOptional()
  @IsString()
  AI_PROVIDER?: string;

  @IsOptional()
  @IsString()
  AI_MODEL?: string;

  @IsOptional()
  @IsString()
  AI_API_KEY?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  AI_BASE_URL?: string;

  @IsOptional()
  @IsString()
  TALLY_CONNECTOR_URL?: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  ENCRYPTION_KEY?: string;
}

/** Parse a comma-separated CORS_ORIGIN into an origin list. */
export function parseCorsOrigins(raw: string | undefined): string[] | true {
  if (!raw || raw.trim() === '' || raw.trim() === '*') return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }
  return validated;
}
