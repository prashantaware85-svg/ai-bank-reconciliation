/**
 * Centralized safe error-log helpers (Step 17).
 *
 * Guarantees:
 * - error records carry timestamp, level, request ID, method, path,
 *   status code, and a safe message — nothing else;
 * - request bodies, query strings, and most headers are NEVER logged;
 * - known secret shapes are redacted/scrubbed (best-effort pattern
 *   scrub on free text; primary guarantee is structural exclusion).
 */

export const REDACTED = '[REDACTED]';

/** Normalized (lowercase, no separators) header/field names that are secrets. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'proxyauthorization',
  'apikey',
  'xapikey',
  'databaseurl',
  'jwt',
  'cookie',
  'setcookie',
  'sessionid',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

/** True when a header/field name must never appear in logs. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/**
 * Copy headers, replacing sensitive values (any casing) with REDACTED.
 * Provided for the rare cases where headers must be attached to a record;
 * the Step 17 filter logs NO headers at all by default.
 */
export function sanitizeHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    out[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return out;
}

/**
 * Best-effort scrub of well-formed secret shapes inside free text
 * (fake-looking or real). Application code must still never place
 * secrets in exception messages — this is a safety net, not a permit.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9]{20,}/g, 'sk-' + REDACTED)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ' + REDACTED)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://' + REDACTED)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED);
}

/** Collapse to a single log-safe line and cap length (blocks log injection). */
export function toLogSafeLine(text: string, maxLength = 500): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export interface SafeErrorLog {
  timestamp: string;
  level: 'error';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  message: string;
}

/**
 * Build the single structured record the global filter logs per failed
 * request. Path is query-free (callers must pass req.path, never req.url).
 * 5xx messages are always generic so internals can never leak.
 */
export function buildSafeErrorLog(input: {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode: number;
  message?: string;
}): SafeErrorLog {
  const rawPath = input.path ?? 'unknown';
  const path = rawPath.split('?')[0].split('#')[0] || 'unknown';
  const fallbackMessage =
    input.statusCode >= 500 ? 'Internal server error' : 'Request failed';
  const rawMessage =
    input.statusCode >= 500 ? fallbackMessage : (input.message ?? fallbackMessage);
  return {
    timestamp: new Date().toISOString(),
    level: 'error',
    requestId: input.requestId && input.requestId.trim() ? input.requestId : 'unknown',
    method: input.method ?? 'unknown',
    path,
    statusCode: input.statusCode,
    message: toLogSafeLine(scrubSecrets(rawMessage)) || fallbackMessage,
  };
}
