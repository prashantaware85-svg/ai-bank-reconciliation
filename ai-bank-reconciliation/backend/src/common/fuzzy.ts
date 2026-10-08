/**
 * Deterministic fuzzy similarity. Token-set Jaccard (legal suffixes
 * stripped) for multi-word names + Levenshtein ratio for single tokens.
 * Well-tested classic algorithms — LLMs are never relied on for string
 * similarity. Returns 0..1 (1 = identical).
 *
 * "ABC TRADERS PVT LTD" vs "ABC TRADERS PRIVATE LIMITED" → 1 (HIGH).
 * "XYZ TRADERS" vs "ABC TRADERS" → 0 (LOW).
 */
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

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

export function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function tokens(normalized: string): string[] {
  return normalized
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function similarity(a: string, b: string): number {
  if (!a?.trim() && !b?.trim()) return 1;
  if (!a?.trim() || !b?.trim()) return 0;
  const ta = tokens(a).filter((t) => !LEGAL_SUFFIXES.has(t));
  const tb = tokens(b).filter((t) => !LEGAL_SUFFIXES.has(t));
  if (ta.length > 1 || tb.length > 1) {
    const union = new Set([...ta, ...tb]);
    if (union.size === 0) return 1;
    const shared = new Set(ta.filter((t) => tb.includes(t)));
    return shared.size / union.size;
  }
  return levenshteinRatio(ta[0] ?? '', tb[0] ?? '');
}

export interface SimilarityEvidence {
  narration?: number;
  party?: number;
  reference?: number;
}

/** Similarity verdict bands (application defaults, configurable). */
export function similarityVerdict(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 0.85) return 'HIGH';
  if (score >= 0.6) return 'MEDIUM';
  return 'LOW';
}
