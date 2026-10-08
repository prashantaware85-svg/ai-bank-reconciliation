import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionLoggingFilter } from './http-exception-logging.filter.js';

function mockHost(req: Record<string, unknown>) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { headersSent: false, status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    // BaseExceptionFilter delegation reads these; keep the mock faithful.
    getArgByIndex: (index: number) => (index === 0 ? req : res),
    getArgs: () => [req, res],
    getType: () => 'http',
  } as unknown as ArgumentsHost;
  return { host, json, status, res };
}

/** Stub the Express adapter Nest normally injects into the base filter. */
function withAdapterStub(filter: HttpExceptionLoggingFilter) {
  const reply = vi.fn();
  (filter as unknown as { applicationRef: unknown }).applicationRef = {
    isHeadersSent: () => false,
    reply,
  };
  return { reply };
}

function lastLog(filter: HttpExceptionLoggingFilter): Record<string, unknown> {
  const spy = (filter as unknown as { logger: { error: ReturnType<typeof vi.fn> } }).logger.error;
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
}

describe('HttpExceptionLoggingFilter (Step 17)', () => {
  it('logs the same request ID on HTTP errors and never logs the token', () => {
    const filter = new HttpExceptionLoggingFilter();
    const { reply } = withAdapterStub(filter);
    const errorSpy = vi.spyOn(
      (filter as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
      'error',
    );
    const { host } = mockHost({
      method: 'GET',
      path: '/companies',
      headers: { authorization: 'Bearer FAKE-JWT-VALUE-123' },
      requestId: 'corr-test-42',
    });
    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);
    const record = lastLog(filter);
    expect(record['requestId']).toBe('corr-test-42');
    expect(record['method']).toBe('GET');
    expect(record['path']).toBe('/companies');
    expect(record['statusCode']).toBe(401);
    expect(record['level']).toBe('error');
    expect(typeof record['timestamp']).toBe('string');
    expect(JSON.stringify(record)).not.toContain('FAKE-JWT-VALUE-123');
    // Default Nest response behavior preserved (delegated to base filter).
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][1]).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('logs a generic message for unexpected 500s without leaking internals', () => {
    const filter = new HttpExceptionLoggingFilter();
    const { reply } = withAdapterStub(filter);
    vi.spyOn(
      (filter as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
      'error',
    );
    const { host } = mockHost({
      method: 'POST',
      path: '/reconciliation/run',
      headers: {},
    });
    filter.catch(
      new Error('connect ECONNREFUSED postgres://fake-user:fake-pass@db:5432/app'),
      host,
    );
    const record = lastLog(filter);
    expect(record['statusCode']).toBe(500);
    expect(record['message']).toBe('Internal server error');
    expect(record['requestId']).toBe('unknown');
    expect(JSON.stringify(record)).not.toContain('fake-pass');
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][1]).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  it('scrubs secret-shaped text that reaches a 4xx message (fake values)', () => {
    const filter = new HttpExceptionLoggingFilter();
    const { reply } = withAdapterStub(filter);
    vi.spyOn(
      (filter as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
      'error',
    );
    const { host } = mockHost({
      method: 'POST',
      path: '/auth/login',
      headers: {},
      requestId: 'corr-scrub-7',
    });
    filter.catch(
      new HttpException(
        'login failed for sk-FAKEFAKEFAKEFAKEFAKE12 bearer',
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );
    const record = lastLog(filter);
    expect(record['requestId']).toBe('corr-scrub-7');
    expect(JSON.stringify(record)).not.toContain('sk-FAKEFAKEFAKEFAKEFAKE12');
    // Client response is untouched (only the log line is scrubbed).
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][2]).toBe(400);
  });
});
