/**
 * Normalization shared philosophy with the backend bank module:
 * trim → collapse whitespace → UPPERCASE → strip punctuation.
 * Originals are always preserved alongside normalized forms.
 */
export function normalizeText(value: unknown): string | undefined {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : undefined;
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return (
    trimmed
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || undefined
  );
}
