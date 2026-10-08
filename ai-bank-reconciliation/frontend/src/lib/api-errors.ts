/**
 * Step 19: API error shape with support correlation.
 *
 * Failed API responses carry the backend `X-Request-Id` (Step 16/17) so an
 * accountant can quote it to support. Only the validated request ID is
 * ever surfaced — never tokens, bodies, or other response details.
 */

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Backend request IDs are UUIDs or safe support tokens (Step 16 policy). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** True when a header value is safe to display as a support reference. */
export function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value);
}

/** Error thrown by the api.ts helpers on non-2xx responses. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    if (isSafeRequestId(requestId)) {
      this.requestId = requestId;
    }
  }
}

interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Read and validate the correlation header from a fetch Response.
 * Returns undefined when absent (e.g. cross-origin without exposure,
 * network failure) or when the value is not a safe request ID.
 */
export function readRequestId(
  headers: HeadersLike | undefined | null,
): string | undefined {
  if (!headers || typeof headers.get !== "function") return undefined;
  try {
    const value = headers.get(REQUEST_ID_HEADER);
    return isSafeRequestId(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface DisplayError {
  message: string;
  requestId?: string;
}

/**
 * Convert any caught value into safe display parts. Messages come from
 * the server error body (unchanged); the request ID is shown only when
 * it passes validation, so hostile header values can never reach the UI.
 */
export function toDisplayError(err: unknown): DisplayError {
  if (err instanceof ApiRequestError) {
    return { message: err.message, requestId: err.requestId };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  if (typeof err === "string" && err) {
    return { message: err };
  }
  return { message: "Request failed" };
}
