import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
} from './request-id.middleware.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function harness(headers: Record<string, string | string[] | undefined> = {}) {
  const req = { headers } as unknown as Request & { requestId?: string };
  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, setHeader, next };
}

describe('RequestIdMiddleware (Step 16 correlation)', () => {
  it('generates a UUID v4 when no incoming ID is present', () => {
    const { req, res, setHeader, next } = harness();
    new RequestIdMiddleware().use(req, res, next);
    expect(req.requestId).toMatch(UUID_V4);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('propagates a valid incoming request ID to request and response', () => {
    const { req, res, setHeader, next } = harness({
      'x-request-id': 'support-ticket-1234.ABC_xyz',
    });
    new RequestIdMiddleware().use(req, res, next);
    expect(req.requestId).toBe('support-ticket-1234.ABC_xyz');
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'support-ticket-1234.ABC_xyz',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces hostile, oversized, or repeated IDs with a generated UUID', () => {
    for (const incoming of [
      'evil\r\nX-Injected: yes',
      'has spaces and/slashes',
      'x'.repeat(129),
      '',
    ]) {
      const { req, res, setHeader, next } = harness({
        'x-request-id': incoming,
      });
      new RequestIdMiddleware().use(req, res, next);
      expect(req.requestId).toMatch(UUID_V4);
      expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    }
    const repeated = harness({ 'x-request-id': ['first', 'second'] });
    new RequestIdMiddleware().use(repeated.req, repeated.res, repeated.next);
    expect(repeated.req.requestId).toBe('first');
    expect(repeated.next).toHaveBeenCalledTimes(1);
  });
});
