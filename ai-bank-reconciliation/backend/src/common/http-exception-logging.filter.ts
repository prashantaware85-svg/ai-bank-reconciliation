import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { buildSafeErrorLog } from './safe-error-log.js';
import type { RequestWithId } from './request-id.middleware.js';

/**
 * Global error-logging filter (Step 17, centralized logging).
 *
 * Logs exactly ONE structured JSON line per failed request — timestamp,
 * level, request ID (Step 16 middleware), method, query-free path, status
 * code, safe message — then delegates to BaseExceptionFilter so API
 * response formats are byte-for-byte unchanged. Request bodies, query
 * strings, headers, and tokens are never logged; 5xx messages are generic.
 */
@Catch()
export class HttpExceptionLoggingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : 500;
    const record = buildSafeErrorLog({
      requestId: (req as Partial<RequestWithId>).requestId,
      method: req.method,
      path: req.path,
      statusCode: status,
      message: extractSafeMessage(exception, status),
    });
    this.logger.error(JSON.stringify(record));
    super.catch(exception, host);
  }
}

/** Framework messages for 4xx; generic for 5xx/unknown (never internals). */
function extractSafeMessage(exception: unknown, status: number): string {
  if (status >= 500) return 'Internal server error';
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) {
        const first = message.find((m) => typeof m === 'string');
        if (typeof first === 'string') return first;
      }
    }
    return exception.message;
  }
  return 'Internal server error';
}
