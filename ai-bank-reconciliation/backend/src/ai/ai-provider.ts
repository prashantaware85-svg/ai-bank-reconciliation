export const AI_CLASSIFICATIONS = [
  'NO_EXCEPTION',
  'WRONG_PARTY_CANDIDATE',
  'DUPLICATE_CANDIDATE',
  'AMOUNT_ANOMALY',
  'DATE_ANOMALY',
  'NARRATION_ANOMALY',
  'REVIEW_REQUIRED',
] as const;

export type AiClassificationValue = (typeof AI_CLASSIFICATIONS)[number];

export const AI_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AiRiskLevelValue = (typeof AI_RISK_LEVELS)[number];

export interface AiEvidenceItem {
  field: string;
  bankValue: string | null;
  tallyValue: string | null;
  finding: string;
}

/**
 * Strict structured AI output. Anything that does not satisfy this shape
 * is rejected — arbitrary AI text is never trusted.
 */
export interface AiExceptionAnalysis {
  classification: AiClassificationValue;
  confidence: number;
  riskLevel: AiRiskLevelValue;
  reason: string;
  evidence: AiEvidenceItem[];
  recommendedAction: string;
}

/** Minimum sanitized input; no credentials/PII beyond txn facts. */
export interface AiTransactionInput {
  bank: {
    date: string;
    amount: string;
    direction: string;
    narration?: string;
    reference?: string;
    normalizedNarration?: string;
  };
  tally: {
    date: string;
    amount: string;
    direction: string;
    party?: string;
    ledger?: string;
    narration?: string;
    reference?: string;
    normalizedParty?: string;
  } | null;
  deterministic: {
    matchStatus: string;
    matchType: string;
    confidence: number | null;
    amountDifference?: string | null;
    dateDifferenceDays?: number | null;
    evidence: Record<string, string>;
  };
  fuzzy: {
    narration?: number;
    party?: number;
    reference?: number;
  };
}

/** Provider errors are typed so failures never break reconciliation. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'unavailable'
      | 'timeout'
      | 'malformed'
      | 'auth'
      | 'rate_limited',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** True for failures worth one bounded retry (never auth/malformed). */
export function isRetryableProviderError(error: unknown): boolean {
  return (
    error instanceof AiProviderError &&
    (error.kind === 'unavailable' ||
      error.kind === 'timeout' ||
      error.kind === 'rate_limited')
  );
}

/**
 * Provider abstraction. Implementations must be configurable via env
 * (AI_PROVIDER / AI_API_KEY / AI_MODEL) and return ONLY validated
 * AiExceptionAnalysis objects.
 */
export interface AiExceptionAnalyzer {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  analyzeTransaction(input: AiTransactionInput): Promise<AiExceptionAnalysis>;
  analyzeBatch(
    inputs: AiTransactionInput[],
  ): Promise<AiExceptionAnalysis[]>;
}

export function isAiExceptionAnalysis(value: unknown): value is AiExceptionAnalysis {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v['classification'] !== 'string' ||
    !AI_CLASSIFICATIONS.includes(v['classification'] as AiClassificationValue)
  ) {
    return false;
  }
  if (
    typeof v['confidence'] !== 'number' ||
    !Number.isFinite(v['confidence']) ||
    v['confidence'] < 0 ||
    v['confidence'] > 1
  ) {
    return false;
  }
  if (
    typeof v['riskLevel'] !== 'string' ||
    !AI_RISK_LEVELS.includes(v['riskLevel'] as AiRiskLevelValue)
  ) {
    return false;
  }
  if (typeof v['reason'] !== 'string' || !v['reason'].trim()) return false;
  if (v['recommendedAction'] !== undefined && typeof v['recommendedAction'] !== 'string') {
    return false;
  }
  if (!Array.isArray(v['evidence'])) return false;
  for (const item of v['evidence']) {
    if (!item || typeof item !== 'object') return false;
    const e = item as Record<string, unknown>;
    if (typeof e['field'] !== 'string') return false;
    if (typeof e['finding'] !== 'string') return false;
  }
  return true;
}

/** Extract the first JSON object from AI text (tolerates code fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new AiProviderError('AI response contains no JSON object', 'malformed');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiProviderError('AI response is not valid JSON', 'malformed');
  }
}
