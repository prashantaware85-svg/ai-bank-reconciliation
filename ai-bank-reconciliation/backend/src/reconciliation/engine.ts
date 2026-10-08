import {
  amountKey,
  areDirectionsCompatible,
  compareAmounts,
  compareParty,
  compareReference,
  dateDiffDays,
  dateVerdict,
  type DateVerdict,
  type PartyVerdict,
  type ReferenceVerdict,
} from './compare.js';
import {
  DEFAULT_MATCH_CONFIG,
  type MatchConfig,
} from './match-config.js';

export type MatchStatus =
  | 'MATCHED'
  | 'POSSIBLE_MATCH'
  | 'UNMATCHED'
  | 'AMOUNT_MISMATCH'
  | 'DATE_MISMATCH'
  | 'MISSING_IN_TALLY'
  | 'MISSING_IN_BANK'
  | 'REVIEW_REQUIRED';

export interface EngineBankRow {
  id: string;
  date: Date;
  amount: string;
  direction: string;
  reference?: string;
  normalizedReference?: string;
  chequeNumber?: string;
  normalizedNarration?: string;
  narration?: string;
}

export interface EngineTallyRow {
  id: string;
  date: Date;
  amount: string;
  direction: string;
  reference?: string;
  normalizedParty?: string;
  ledger?: string;
  voucherNo?: string;
}

export interface EngineEvidence {
  amount: 'MATCH' | 'MISMATCH';
  direction: 'MATCH' | 'MISMATCH';
  date: DateVerdict;
  party: PartyVerdict;
  reference: ReferenceVerdict;
}

export type EngineMatchType =
  | 'ONE_TO_ONE'
  | 'ONE_TO_MANY'
  | 'MANY_TO_ONE'
  | 'DUPLICATE_CANDIDATE';

export interface EngineMatch {
  bankId?: string;
  tallyId?: string;
  /** Multi-side links for splits/duplicates (Step 8). */
  bankIds?: string[];
  tallyIds?: string[];
  matchType?: EngineMatchType;
  bankTotal?: string;
  tallyTotal?: string;
  status: MatchStatus;
  confidence?: number;
  evidence: EngineEvidence;
  reason: string;
  amountDifference?: string;
  dateDifferenceDays?: number;
}

export interface EngineOutcome {
  matches: EngineMatch[];
}

/**
 * Matching strategy seam. Step 7 ships OneToOneStrategy (safe 1:1 with
 * consumption).
 *
 * TODO(Step 8): add SplitMatchStrategy (1:N / N:1 amount splits) behind this
 * interface. The result schema already permits several results to reference
 * the same transaction — no migration needed, only a new strategy.
 */
export interface MatchingStrategy {
  name: string;
  match(
    bank: EngineBankRow[],
    tally: EngineTallyRow[],
    config: MatchConfig,
  ): EngineOutcome;
}

interface Scored {
  index: number;
  evidence: EngineEvidence;
  confidence: number;
  dateDiff: number;
}

function evidenceFor(
  bank: EngineBankRow,
  tally: EngineTallyRow,
  toleranceDays: number,
  partialMinLength: number,
): { evidence: EngineEvidence; dateDiff: number; amountDiff: string } {
  const amounts = compareAmounts(bank.amount, tally.amount);
  const dateDiff = dateDiffDays(bank.date, tally.date);
  return {
    evidence: {
      amount: amounts.match ? 'MATCH' : 'MISMATCH',
      direction: areDirectionsCompatible(bank.direction, tally.direction)
        ? 'MATCH'
        : 'MISMATCH',
      date: dateVerdict(dateDiff, toleranceDays),
      party: compareParty(bank.normalizedNarration, tally.normalizedParty),
      reference: compareReference(
        [bank.reference, bank.normalizedReference, bank.chequeNumber],
        tally.reference,
        partialMinLength,
      ),
    },
    dateDiff,
    amountDiff: amounts.difference,
  };
}

function score(evidence: EngineEvidence, config: MatchConfig): number {
  const w = config.weights;
  let total = 0;
  if (evidence.reference === 'EXACT') total += w.reference;
  else if (evidence.reference === 'PARTIAL') total += w.referencePartial;
  if (evidence.amount === 'MATCH') total += w.amount;
  if (evidence.party === 'MATCH') total += w.party;
  else if (evidence.party === 'PARTIAL') total += w.partyPartial;
  if (evidence.date === 'EXACT') total += w.date;
  else if (evidence.date === 'CLOSE') total += w.dateClose;
  // Veto: a hard party contradiction caps the score below MATCHED bands.
  if (evidence.party === 'MISMATCH') total = Math.min(total, 69);
  return Math.min(total, 100);
}

function reasonFor(
  status: MatchStatus,
  confidence: number,
  evidence: EngineEvidence,
  dateDiff: number,
  amountDiff?: string,
): string {
  const bits: string[] = [];
  bits.push(
    evidence.amount === 'MATCH'
      ? 'Amount matches'
      : `Amounts differ by ${amountDiff ?? 'unknown'}`,
  );
  bits.push(
    evidence.direction === 'MATCH'
      ? 'direction is compatible'
      : 'direction conflicts',
  );
  bits.push(
    evidence.date === 'EXACT'
      ? 'dates match exactly'
      : `dates differ by ${dateDiff} day(s)`,
  );
  if (evidence.party !== 'UNKNOWN') {
    bits.push(
      evidence.party === 'MATCH'
        ? 'party matches'
        : evidence.party === 'PARTIAL'
          ? 'party partially matches'
          : 'party evidence is not consistent',
    );
  }
  if (evidence.reference === 'EXACT') bits.push('reference matches exactly');
  else if (evidence.reference === 'PARTIAL') {
    bits.push('reference partially matches');
  }
  const head =
    status === 'MATCHED'
      ? `Matched with confidence ${confidence}`
      : status === 'POSSIBLE_MATCH'
        ? `Possible match with confidence ${confidence}`
        : status === 'AMOUNT_MISMATCH'
          ? 'Probable same transaction with different amounts'
          : status === 'DATE_MISMATCH'
            ? 'Probable same transaction outside the date tolerance'
            : status === 'REVIEW_REQUIRED'
              ? `Needs review with confidence ${confidence}`
              : status === 'MISSING_IN_TALLY'
                ? 'No reasonable Tally candidate in period'
                : status === 'MISSING_IN_BANK'
                  ? 'No reasonable bank candidate in period'
                  : 'Insufficient evidence to match';
  return `${head}: ${bits.join('; ')}.`;
}

/**
 * Safe 1:1 matching. Levels (first hit wins per bank row):
 * 1 exact reference (+amount+direction+date-window) →
 * 2 amount + strong party (+date-window) →
 * 3 amount + partial reference (+date-window) →
 * 4 amount + date only → POSSIBLE_MATCH →
 * 5 strong non-amount evidence, amount differs → AMOUNT_MISMATCH →
 * 6 strong evidence, date outside tolerance → DATE_MISMATCH.
 * Consumed tally rows are never reused.
 */
export class OneToOneStrategy implements MatchingStrategy {
  readonly name = 'one-to-one';

  match(
    bankRows: EngineBankRow[],
    tallyRows: EngineTallyRow[],
    config: MatchConfig = DEFAULT_MATCH_CONFIG,
  ): EngineOutcome {
    const tol = config.dateToleranceDays;
    // Exact-amount candidate index (common path stays sub-quadratic).
    const byAmount = new Map<string, number[]>();
    // Reference index for amount-mismatch hunting (L5).
    const byReference = new Map<string, number[]>();
    tallyRows.forEach((t, i) => {
      const key = amountKey(t.amount);
      if (key) {
        const list = byAmount.get(key);
        if (list) list.push(i);
        else byAmount.set(key, [i]);
      }
      const ref = (t.reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (ref) {
        const list = byReference.get(ref);
        if (list) list.push(i);
        else byReference.set(ref, [i]);
      }
    });
    const consumed = new Set<number>();
    const matches: EngineMatch[] = [];
    const ordered = [...bankRows].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );

    const sameAmountOpen = (bank: EngineBankRow): number[] => {
      const key = amountKey(bank.amount);
      if (!key) return [];
      return (byAmount.get(key) ?? []).filter((i) => !consumed.has(i));
    };
    const bankRefKeys = (bank: EngineBankRow): string[] => {
      const keys = [bank.reference, bank.normalizedReference, bank.chequeNumber]
        .map((r) => (r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
        .filter(Boolean);
      return [...new Set(keys)];
    };

    for (const bank of ordered) {
      const pick = this.pickCandidate(
        bank,
        tallyRows,
        sameAmountOpen(bank),
        bankRefKeys(bank),
        byReference,
        consumed,
        config,
      );
      if (pick) {
        const { candidate, level } = pick;
        const tally = tallyRows[candidate.index] as EngineTallyRow;
        consumed.add(candidate.index);
        // Level-assigned statuses bypass bands; scored levels go through bands.
        const finalStatus =
          level === 4 || level === 5 || level === 6
            ? this.statusFor(candidate, level, config)
            : this.bandStatus(candidate.confidence, candidate.evidence, config)
                .status;
        const confidence = candidate.confidence;
        matches.push({
          bankId: bank.id,
          tallyId: tally.id,
          status: finalStatus,
          confidence,
          evidence: candidate.evidence,
          reason: reasonFor(
            finalStatus,
            confidence,
            candidate.evidence,
            candidate.dateDiff,
            candidate.evidence.amount === 'MISMATCH'
              ? compareAmounts(bank.amount, tally.amount).difference
              : undefined,
          ),
          amountDifference:
            candidate.evidence.amount === 'MISMATCH'
              ? compareAmounts(bank.amount, tally.amount).difference
              : '0',
          dateDifferenceDays: candidate.dateDiff,
        });
        continue;
      }
      matches.push(this.unlinked(bank, tallyRows, tol));
    }

    for (let i = 0; i < tallyRows.length; i += 1) {
      if (consumed.has(i)) continue;
      const tally = tallyRows[i] as EngineTallyRow;
      // Nearby means any bank activity in the window — consumed rows still
      // count as activity (their explanation is taken, so this row needs eyes).
      const nearby = ordered.some(
        (b) => dateDiffDays(b.date, tally.date) <= tol,
      );
      if (nearby) {
        matches.push({
          tallyId: tally.id,
          status: 'UNMATCHED',
          evidence: {
            amount: 'MISMATCH',
            direction: 'MATCH',
            date: 'CLOSE',
            party: 'UNKNOWN',
            reference: 'MISSING',
          },
          reason:
            'Tally transaction has bank activity nearby but insufficient evidence to link.',
        });
      } else {
        matches.push({
          tallyId: tally.id,
          status: 'MISSING_IN_BANK',
          evidence: {
            amount: 'MISMATCH',
            direction: 'MATCH',
            date: 'FAR',
            party: 'UNKNOWN',
            reference: 'MISSING',
          },
          reason: 'No reasonable bank candidate in period.',
        });
      }
    }

    return { matches };
  }

  private pickCandidate(
    bank: EngineBankRow,
    tallyRows: EngineTallyRow[],
    open: number[],
    bankRefKeys: string[],
    byReference: Map<string, number[]>,
    consumed: Set<number>,
    config: MatchConfig,
  ): { candidate: Scored; level: 1 | 2 | 3 | 4 | 5 | 6 } | undefined {
    const tol = config.dateToleranceDays;
    const scoreRow = (index: number): Scored => {
      const tally = tallyRows[index] as EngineTallyRow;
      const { evidence, dateDiff } = evidenceFor(
        bank,
        tally,
        tol,
        config.referencePartialMinLength,
      );
      return {
        index,
        evidence,
        confidence: score(evidence, config),
        dateDiff,
      };
    };
    const dirOk = (s: { evidence: EngineEvidence }) =>
      s.evidence.direction === 'MATCH';
    const scored = open.map(scoreRow);
    const inWindow = scored.filter(
      (s) => dirOk(s) && s.evidence.date !== 'FAR',
    );
    const byDateThenConfidence = (a: Scored, b: Scored) =>
      a.dateDiff - b.dateDiff || b.confidence - a.confidence;

    const l1 = inWindow
      .filter(
        (s) =>
          s.evidence.reference === 'EXACT' && s.evidence.amount === 'MATCH',
      )
      .sort(byDateThenConfidence)[0];
    if (l1) return { candidate: l1, level: 1 };

    const l2 = inWindow
      .filter(
        (s) =>
          s.evidence.amount === 'MATCH' && s.evidence.party === 'MATCH',
      )
      .sort(byDateThenConfidence)[0];
    if (l2) return { candidate: l2, level: 2 };

    const l3 = inWindow
      .filter(
        (s) =>
          s.evidence.amount === 'MATCH' &&
          s.evidence.reference === 'PARTIAL',
      )
      .sort(byDateThenConfidence)[0];
    if (l3) return { candidate: l3, level: 3 };

    // Level 5: exact reference + compatible direction but different amount
    // (reference index reaches beyond the same-amount set).
    const l5ref = bankRefKeys
      .flatMap((key) => byReference.get(key) ?? [])
      .filter((i) => !consumed.has(i))
      .map(scoreRow)
      .filter(
        (s) => dirOk(s) && s.evidence.amount === 'MISMATCH',
      )
      .sort(byDateThenConfidence)[0];
    if (l5ref) return { candidate: l5ref, level: 5 };
    // Level 5 fallback: strong party + partial reference inside the window.
    const l5party = tallyRows
      .map((_, i) => i)
      .filter((i) => !consumed.has(i))
      .map(scoreRow)
      .filter(
        (s) =>
          dirOk(s) &&
          s.evidence.amount === 'MISMATCH' &&
          s.evidence.date !== 'FAR' &&
          s.evidence.party === 'MATCH' &&
          s.evidence.reference === 'PARTIAL',
      )
      .sort(byDateThenConfidence)[0];
    if (l5party) return { candidate: l5party, level: 5 };

    // Level 6: amount + strong evidence, date outside tolerance.
    const l6 = scored
      .filter(
        (s) =>
          dirOk(s) &&
          s.evidence.amount === 'MATCH' &&
          s.evidence.date === 'FAR' &&
          (s.evidence.reference === 'EXACT' ||
            s.evidence.party === 'MATCH'),
      )
      .sort(byDateThenConfidence)[0];
    if (l6) return { candidate: l6, level: 6 };

    // Fallback: best in-window candidate by confidence. >= review band
    // links with band status; weaker amount+date-only links stay POSSIBLE
    // (Level 4: evidence missing but amount+date agree).
    const best = inWindow.sort(byDateThenConfidence)[0];
    if (best && best.confidence >= config.bands.reviewMin) {
      return { candidate: best, level: 3 };
    }

    const l4 = inWindow
      .filter((s) => s.evidence.amount === 'MATCH')
      .sort(byDateThenConfidence)[0];
    if (l4) return { candidate: l4, level: 4 };

    return undefined;
  }

  private bandStatus(
    confidence: number,
    evidence: EngineEvidence,
    config: MatchConfig,
  ): { status: MatchStatus; confidence: number } {
    const b = config.bands;
    const strong =
      evidence.reference === 'EXACT' || evidence.party === 'MATCH';
    if (confidence >= b.matchedMin) return { status: 'MATCHED', confidence };
    if (confidence >= b.strongPossibleMin) {
      return strong
        ? { status: 'MATCHED', confidence }
        : { status: 'POSSIBLE_MATCH', confidence };
    }
    if (confidence >= b.possibleMin) {
      return { status: 'POSSIBLE_MATCH', confidence };
    }
    if (confidence >= b.reviewMin) {
      return { status: 'REVIEW_REQUIRED', confidence };
    }
    return { status: 'UNMATCHED', confidence };
  }

  private statusFor(
    candidate: Scored,
    level: 1 | 2 | 3 | 4 | 5 | 6,
    config: MatchConfig,
  ): MatchStatus {
    void config;
    if (level === 4) return 'POSSIBLE_MATCH';
    if (level === 5) return 'AMOUNT_MISMATCH';
    if (level === 6) return 'DATE_MISMATCH';
    return this.bandStatus(candidate.confidence, candidate.evidence, config)
      .status;
  }

  private unlinked(
    bank: EngineBankRow,
    tallyRows: EngineTallyRow[],
    tol: number,
  ): EngineMatch {
    const nearby = tallyRows.some(
      (t) => dateDiffDays(bank.date, t.date) <= tol,
    );
    const evidence: EngineEvidence = {
      amount: 'MISMATCH',
      direction: 'MATCH',
      date: nearby ? 'CLOSE' : 'FAR',
      party: 'UNKNOWN',
      reference: 'MISSING',
    };
    const status: MatchStatus = nearby ? 'UNMATCHED' : 'MISSING_IN_TALLY';
    return {
      bankId: bank.id,
      status,
      evidence,
      reason: reasonFor(status, 0, evidence, nearby ? tol : tol + 1),
      amountDifference: undefined,
      dateDifferenceDays: undefined,
    };
  }
}

/**
 * Runs the given strategy over loaded rows. Pure and synchronous; the
 * service layer handles loading/persistence so a future BullMQ worker can
 * reuse this exact function.
 */
export function runReconciliation(
  bank: EngineBankRow[],
  tally: EngineTallyRow[],
  strategy: MatchingStrategy = new OneToOneStrategy(),
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): EngineOutcome {
  return strategy.match(bank, tally, config);
}

/** Seam for future background processing (Step 8+: Redis + BullMQ). */
export interface ReconciliationJob {
  runId: string;
}

export interface ReconciliationQueue {
  enqueue(job: ReconciliationJob): Promise<void>;
}

/**
 * Inline queue: executes synchronously in the request lifecycle.
 * TODO(Step 8): replace with a BullMQ-backed implementation; the service
 * already depends only on the ReconciliationQueue interface.
 */
export class InlineReconciliationQueue implements ReconciliationQueue {
  constructor(private readonly execute: (runId: string) => Promise<void>) {}

  async enqueue(job: ReconciliationJob): Promise<void> {
    await this.execute(job.runId);
  }
}
