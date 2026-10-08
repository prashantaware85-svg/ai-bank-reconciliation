import { Decimal } from 'decimal.js';

export type PartyVerdict = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';
export type ReferenceVerdict = 'EXACT' | 'PARTIAL' | 'MISMATCH' | 'MISSING';
export type DateVerdict = 'EXACT' | 'CLOSE' | 'FAR';

/** Legal-entity suffixes ignored for strong party comparison. */
const LEGAL_SUFFIXES = new Set([
  'PVT',
  'LTD',
  'LIMITED',
  'PRIVATE',
  'CO',
  'COMPANY',
  'LLP',
  'INC',
  'CORP',
  'CORPORATION',
]);

function tokens(normalized?: string): string[] {
  return (normalized ?? '').split(' ').filter(Boolean);
}

function stripLegal(parts: string[]): string[] {
  return parts.filter((t) => !LEGAL_SUFFIXES.has(t));
}

/**
 * Deterministic party comparison on normalized forms.
 * "ABC TRADERS PVT LTD" vs "ABC TRADERS PRIVATE LIMITED" → MATCH (suffixes
 * stripped); "ABC TRADERS" vs "XYZ TRADERS" → MISMATCH. Never concludes
 * WRONG_PARTY — that classification belongs to a later step.
 */
export function compareParty(
  bankNormalized?: string,
  tallyNormalized?: string,
): PartyVerdict {
  if (!bankNormalized && !tallyNormalized) return 'UNKNOWN';
  if (!bankNormalized || !tallyNormalized) return 'UNKNOWN';
  if (bankNormalized === tallyNormalized) return 'MATCH';

  const a = stripLegal(tokens(bankNormalized));
  const b = stripLegal(tokens(tallyNormalized));
  if (a.length > 0 && a.join(' ') === b.join(' ')) return 'MATCH';

  const setB = new Set(b);
  const inter = a.filter((t) => setB.has(t));
  if (
    inter.length > 0 &&
    (inter.length === a.length || inter.length === b.length)
  ) {
    return 'PARTIAL';
  }
  const union = new Set([...a, ...b]).size;
  if (union > 0 && inter.length / union >= 0.6) return 'PARTIAL';
  return 'MISMATCH';
}

function refNorm(value?: string): string | undefined {
  const n = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n || undefined;
}

/**
 * Reference comparison across bank identifiers (reference, normalized
 * reference, cheque number) versus the Tally reference. Originals untouched.
 */
export function compareReference(
  bankRefs: (string | undefined)[],
  tallyRef: string | undefined,
  partialMinLength = 4,
): ReferenceVerdict {
  const ours = bankRefs
    .map(refNorm)
    .filter((r): r is string => Boolean(r));
  const theirs = refNorm(tallyRef);
  if (ours.length === 0 && !theirs) return 'MISSING';
  if (ours.length === 0 || !theirs) return 'MISSING';
  if (ours.some((r) => r === theirs)) return 'EXACT';
  if (
    ours.some(
      (r) =>
        (theirs.includes(r) || r.includes(theirs)) &&
        Math.min(r.length, theirs.length) >= partialMinLength,
    )
  ) {
    return 'PARTIAL';
  }
  return 'MISMATCH';
}

/** Absolute calendar-day difference (UTC, deterministic). */
export function dateDiffDays(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.abs(Math.round((utcA - utcB) / 86400000));
}

export function dateVerdict(diffDays: number, toleranceDays: number): DateVerdict {
  if (diffDays === 0) return 'EXACT';
  if (diffDays <= toleranceDays) return 'CLOSE';
  return 'FAR';
}

/** Exact decimal equality + absolute difference (decimal.js, never float). */
export function compareAmounts(
  bankAmount: string,
  tallyAmount: string,
): { match: boolean; difference: string } {
  const b = new Decimal(bankAmount);
  const t = new Decimal(tallyAmount);
  return {
    match: b.equals(t),
    difference: b.minus(t).abs().toString(),
  };
}

/** Canonical decimal key for candidate indexing ('5000.00' → '5000'). */
export function amountKey(raw: string): string | undefined {
  try {
    return new Decimal(raw).toString();
  } catch {
    return undefined;
  }
}

/**
 * Direction compatibility. Both sides use the bank-statement convention
 * (DEBIT = money out, CREDIT = money in; the Tally agent maps Tally entries
 * to it at ingestion). Strict mode requires equality; the function is
 * configurable for future lenient modes. Opposite directions never match.
 */
export function areDirectionsCompatible(
  bankDirection: string,
  tallyDirection: string,
  mode: 'strict' = 'strict',
): boolean {
  void mode;
  return bankDirection === tallyDirection;
}
