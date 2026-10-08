import { describe, expect, it } from 'vitest';
import {
  buildSafeErrorLog,
  isSensitiveKey,
  REDACTED,
  sanitizeHeaders,
  scrubSecrets,
  toLogSafeLine,
} from './safe-error-log.js';

describe('safe-error-log (Step 17 centralized logging)', () => {
  it('builds a complete record with timestamp, level, id, method, path, status, message', () => {
    const record = buildSafeErrorLog({
      requestId: 'req-abc-123',
      method: 'POST',
      path: '/auth/login',
      statusCode: 401,
      message: 'Unauthorized',
    });
    expect(record.level).toBe('error');
    expect(record.requestId).toBe('req-abc-123');
    expect(record.method).toBe('POST');
    expect(record.path).toBe('/auth/login');
    expect(record.statusCode).toBe(401);
    expect(record.message).toBe('Unauthorized');
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
    expect(Object.keys(record).sort()).toEqual(
      ['level', 'message', 'method', 'path', 'requestId', 'statusCode', 'timestamp'].sort(),
    );
  });

  it('strips query strings/fragments and defaults a missing request ID', () => {
    const record = buildSafeErrorLog({
      method: 'GET',
      path: '/reports/export/reconciliation.xlsx?token=FAKE&x=1#frag',
      statusCode: 400,
      message: 'Bad Request',
    });
    expect(record.path).toBe('/reports/export/reconciliation.xlsx');
    expect(record.requestId).toBe('unknown');
    expect(JSON.stringify(record)).not.toContain('FAKE');
  });

  it('forces a generic message for 5xx so internals never leak', () => {
    const record = buildSafeErrorLog({
      requestId: 'r1',
      method: 'GET',
      path: '/reconciliation/run',
      statusCode: 500,
      message: 'connect ECONNREFUSED postgres://fake-user:fake-pass@db:5432/app',
    });
    expect(record.message).toBe('Internal server error');
    expect(JSON.stringify(record)).not.toContain('fake-pass');
  });

  it('collapses log-injection newlines and caps message length', () => {
    const record = buildSafeErrorLog({
      requestId: 'r2',
      method: 'GET',
      path: '/x',
      statusCode: 400,
      message: 'bad\r\nINJECTED-LINE\nsecond',
    });
    expect(record.message).not.toMatch(/[\r\n]/);
    expect(record.message).toContain('INJECTED-LINE');
    expect(toLogSafeLine('y'.repeat(600))).toHaveLength(500);
  });

  it('redacts sensitive headers case-insensitively and keeps safe ones', () => {
    const out = sanitizeHeaders({
      authorization: 'Bearer FAKE-JWT-VALUE',
      Cookie: 'refresh=FAKE-REFRESH',
      'Content-Type': 'application/json',
      'X-Request-Id': 'req-1',
    });
    expect(out['authorization']).toBe(REDACTED);
    expect(out['Cookie']).toBe(REDACTED);
    expect(out['Content-Type']).toBe('application/json');
    expect(out['X-Request-Id']).toBe('req-1');
    expect(JSON.stringify(out)).not.toContain('FAKE-JWT-VALUE');
  });

  it('classifies secret field names and leaves ordinary names alone', () => {
    for (const k of [
      'password', 'PASSWORD', 'api_key', 'API-KEY', 'DATABASE_URL',
      'databaseUrl', 'Authorization', 'refreshToken', 'access_token', 'jwt', 'cookie',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
    for (const k of ['Content-Type', 'X-Request-Id', 'companyName', 'amount']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });

  it('scrubs well-formed secret shapes from free text (fake values)', () => {
    const scrubbed = scrubSecrets(
      'key sk-FAKEFAKEFAKEFAKEFAKE12 and Bearer FAKEBEARER.token-9 plus postgres://fake:fake@host/db',
    );
    expect(scrubbed).not.toContain('sk-FAKEFAKEFAKEFAKEFAKE12');
    expect(scrubbed).not.toContain('FAKEBEARER.token-9');
    expect(scrubbed).not.toContain('fake:fake@host');
    expect(scrubbed).toContain(REDACTED);
  });
});
