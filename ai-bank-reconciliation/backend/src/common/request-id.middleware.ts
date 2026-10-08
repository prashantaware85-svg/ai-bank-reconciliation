import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Response/request header carrying the correlation ID. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Incoming IDs are accepted only when they are safe to echo into logs
 * and headers (prevents header/log injection via a hostile request ID).
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Express request with the Step 16 correlation ID attached. */
export interface RequestWithId extends Request {
  requestId: string;
}

/**
 * Request-ID correlation middleware (Step 16).
 *
 * Reuses a valid incoming X-Request-Id, otherwise generates a UUID v4.
 * The ID is attached to the request for future centralized logging and
 * echoed on the response so operators can correlate log lines, audit
 * rows, and client-reported issues. It carries no PII and changes no
 * routing, auth, or response-body behavior.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId =
      candidate && SAFE_REQUEST_ID.test(candidate)
        ? candidate
        : randomUUID();
    (req as RequestWithId).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
