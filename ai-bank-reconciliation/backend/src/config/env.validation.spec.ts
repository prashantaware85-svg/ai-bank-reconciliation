import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { parseCorsOrigins, validateEnv } from './env.validation.js';

const valid = (): Record<string, unknown> => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
});

describe('env validation', () => {
  it('accepts a complete valid environment with defaults', () => {
    const env = validateEnv(valid());
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(env.CORS_ORIGIN).toBe('*');
  });

  it('rejects missing DATABASE_URL', () => {
    const env = valid();
    delete env.DATABASE_URL;
    expect(() => validateEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT secrets without leaking them', () => {
    const env = valid();
    env.JWT_SECRET = 'short-secret-value';
    let message = '';
    try {
      validateEnv(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).not.toContain('short-secret-value');
  });

  it('rejects missing JWT_REFRESH_SECRET', () => {
    const env = valid();
    delete env.JWT_REFRESH_SECRET;
    expect(() => validateEnv(env)).toThrow(/JWT_REFRESH_SECRET/);
  });
});

describe('parseCorsOrigins', () => {
  it('allows wildcard only for development default', () => {
    expect(parseCorsOrigins(undefined)).toBe(true);
    expect(parseCorsOrigins('*')).toBe(true);
    expect(parseCorsOrigins('')).toBe(true);
  });

  it('parses a comma-separated allow-list', () => {
    expect(
      parseCorsOrigins('https://app.example.com, https://admin.example.com'),
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });
});
