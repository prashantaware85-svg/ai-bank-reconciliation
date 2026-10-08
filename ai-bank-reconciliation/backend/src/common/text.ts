/**
 * Shared text helpers (bank + tally modules use identical philosophy).
 *
 * normalizeText: trim → collapse whitespace → uppercase → strip punctuation
 * (keep letters, digits, spaces) → collapse/trim again.
 * Example: "ABC Traders Pvt. Ltd." → "ABC TRADERS PVT LTD".
 * Originals are always preserved alongside normalized forms.
 */

/** Convert a scalar cell to text; objects become undefined (never "[object Object]"). */
export function cellText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  return undefined;
}

export function normalizeText(value: unknown): string | undefined {
  const raw = cellText(value)?.trim();
  if (!raw) return undefined;
  return raw
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

/** Normalize a header/label for alias lookup: lowercase, alphanumerics only. */
export function normalizeHeader(value: unknown): string {
  return (cellText(value) ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
