import { Decimal } from 'decimal.js';
import {
  compareParty,
  compareReference,
  dateDiffDays,
  type PartyVerdict,
  type ReferenceVerdict,
} from './compare.js';
import {
  DEFAULT_MATCH_CONFIG,
  type MatchConfig,
} from './match-config.js';
import {
  OneToOneStrategy,
  type EngineBankRow,
  type EngineMatch,
  type EngineMatchType,
  type EngineOutcome,
  type EngineTallyRow,
  type MatchingStrategy,
} from './engine.js';

export interface SplitConfig {
  maxSplitItems: number;
  /** Max opposite-side rows considered per target (nearest by date win). */
  maxSplitPoolSize: number;
  /** Hard stop on subset evaluations per target (combinatorial guard). */
  maxSubsetsEvaluated: number;
  /** Allowed total rounding error, Decimal string. Default '0'. */
  roundingTolerance: string;
}

export const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  maxSplitItems: 5,
  maxSplitPoolSize: 24,
  maxSubsetsEvaluated: 50000,
  roundingTolerance: '0',
};

interface Part {
  key: string;
  amount: Decimal;
  date: Date;
}

/**
 * Bounded subset-sum over positive magnitudes with pruning.
 * Returns part-key sets of size >= 2 whose sum equals target ± tolerance,
 * in deterministic DFS order. Never uses floating point.
 */
export function findSplitCombos(
  target: Decimal,
  parts: Part[],
  maxItems: number,
  tolerance: Decimal,
  maxEvaluated: number,
): string[][] {
  const out: string[][] = [];
  let evaluated = 0;
  const upper = target.plus(tolerance);

  const dfs = (
    start: number,
    chosen: string[],
    sum: Decimal,
  ): boolean => {
    for (let i = start; i < parts.length; i += 1) {
      if (evaluated >= maxEvaluated) return true;
      const part = parts[i] as Part;
      if (part.amount.lte(0)) {
        evaluated += 1;
        continue;
      }
      const next = sum.plus(part.amount);
      evaluated += 1;
      if (next.minus(target).abs().lte(tolerance)) {
        if (chosen.length + 1 >= 2) out.push([...chosen, part.key]);
        continue; // magnitudes are positive: deeper only overshoots
      }
      if (next.gt(upper)) continue; // prune: can only grow from here
      if (chosen.length + 1 < maxItems) {
        if (dfs(i + 1, [...chosen, part.key], next)) return true;
      }
    }
    return false;
  };

  dfs(0, [], new Decimal(0));
  return out;
}

function rankOf(v: string): number {
  if (v === 'MATCH' || v === 'EXACT') return 3;
  if (v === 'PARTIAL') return 2;
  if (v === 'UNKNOWN' || v === 'MISSING') return 1;
  return 0;
}

interface ComboEvidence {
  date: 'EXACT' | 'CLOSE' | 'FAR';
  party: PartyVerdict;
  reference: ReferenceVerdict;
  maxDateDiff: number;
  refExactCount: number;
  partyMatchCount: number;
}

function aggregateEvidence(
  verdicts: { date: 'EXACT' | 'CLOSE' | 'FAR'; party: PartyVerdict; reference: ReferenceVerdict }[],
): ComboEvidence {
  let date: 'EXACT' | 'CLOSE' | 'FAR' = 'EXACT';
  let maxDateDiff = 0;
  let party: PartyVerdict = 'UNKNOWN';
  let reference: ReferenceVerdict = 'MISSING';
  let refExactCount = 0;
  let partyMatchCount = 0;
  for (const v of verdicts) {
    if (v.date === 'FAR') date = 'FAR';
    else if (v.date === 'CLOSE' && date === 'EXACT') date = 'CLOSE';
    if (rankOf(v.party) > rankOf(party)) party = v.party;
    if (rankOf(v.reference) > rankOf(reference)) reference = v.reference;
    if (v.reference === 'EXACT') refExactCount += 1;
    if (v.party === 'MATCH') partyMatchCount += 1;
  }
  return { date, party, reference, maxDateDiff, refExactCount, partyMatchCount };
}

function splitConfidence(ev: ComboEvidence): number {
  let total = 70;
  if (ev.reference === 'EXACT') total += 10;
  else if (ev.reference === 'PARTIAL') total += 5;
  if (ev.party === 'MATCH') total += 10;
  else if (ev.party === 'PARTIAL') total += 5;
  if (ev.date === 'EXACT') total += 5;
  else if (ev.date === 'CLOSE') total += 2;
  return Math.min(total, 94); // splits never auto-MATCH
}

/**
 * Duplicate findings over loaded rows. Deterministic, read-only:
 * nothing is deleted or merged — every finding is REVIEW_REQUIRED with
 * evidence, for a human to confirm later.
 */
export function detectDuplicates(
  bank: EngineBankRow[],
  tally: EngineTallyRow[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): EngineMatch[] {
  const tol = config.dateToleranceDays;
  const findings: EngineMatch[] = [];

  const keyOf = (amount: string, direction: string): string | undefined => {
    try {
      return `${new Decimal(amount).toString()}|${direction}`;
    } catch {
      return undefined;
    }
  };

  const bucketize = <T extends { id: string; date: Date }>(
    rows: T[],
    amountOf: (r: T) => string,
    dirOf: (r: T) => string,
  ): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const r of rows) {
      const key = keyOf(amountOf(r), dirOf(r));
      if (!key) continue;
      const list = out.get(key);
      if (list) list.push(r);
      else out.set(key, [r]);
    }
    return out;
  };

  const pairEvidence = (
    aDate: Date,
    bDate: Date,
    aRefs: (string | undefined)[],
    bRef: string | undefined,
    aParty?: string,
    bParty?: string,
  ) => {
    const dateDiff = dateDiffDays(aDate, bDate);
    const reference = compareReference(
      aRefs,
      bRef,
      config.referencePartialMinLength,
    );
    const party = compareParty(aParty, bParty);
    let confidence = 60;
    if (reference === 'EXACT') confidence += 15;
    else if (reference === 'PARTIAL') confidence += 5;
    if (dateDiff === 0) confidence += 10;
    else if (dateDiff <= tol) confidence += 5;
    if (party === 'MATCH') confidence += 10;
    else if (party === 'PARTIAL') confidence += 5;
    return {
      evidence: {
        amount: 'MATCH' as const,
        direction: 'MATCH' as const,
        date: dateDiff === 0 ? ('EXACT' as const) : dateDiff <= tol ? ('CLOSE' as const) : ('FAR' as const),
        party,
        reference,
      },
      dateDiff,
      confidence: Math.min(confidence, 94),
    };
  };

  const describePair = (
    kind: string,
    amount: string,
    dateDiff: number,
  ): string =>
    `Possible duplicate ${kind} (amount ${amount}, ` +
    (dateDiff === 0 ? 'same date' : `dates differ by ${dateDiff} day(s)`) +
    '): human confirmation required; nothing was merged or deleted.';

  // Within-bank pairs.
  for (const group of bucketize(
    bank,
    (r) => r.amount,
    (r) => r.direction,
  ).values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i] as EngineBankRow;
        const b = group[j] as EngineBankRow;
        const dateDiff = dateDiffDays(a.date, b.date);
        if (dateDiff > tol) continue;
        const refVerdict = compareReference(
          [a.reference, a.normalizedReference, a.chequeNumber],
          b.reference ?? b.normalizedReference ?? b.chequeNumber,
          config.referencePartialMinLength,
        );
        const narrEqual =
          !!a.normalizedNarration &&
          a.normalizedNarration === b.normalizedNarration;
        if (refVerdict !== 'EXACT' && !narrEqual) continue;
        const built = pairEvidence(
          a.date,
          b.date,
          [a.reference, a.normalizedReference, a.chequeNumber],
          b.reference ?? b.normalizedReference ?? b.chequeNumber,
          a.normalizedNarration,
          b.normalizedNarration,
        );
        findings.push({
          bankIds: [a.id, b.id],
          bankId: a.id,
          matchType: 'DUPLICATE_CANDIDATE',
          status: 'REVIEW_REQUIRED',
          confidence: built.confidence,
          evidence: built.evidence,
          reason: describePair('within bank transactions', a.amount, dateDiff),
          amountDifference: '0',
          dateDifferenceDays: dateDiff,
        });
      }
    }
  }

  // Within-tally pairs.
  for (const group of bucketize(
    tally,
    (r) => r.amount,
    (r) => r.direction,
  ).values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i] as EngineTallyRow;
        const b = group[j] as EngineTallyRow;
        const dateDiff = dateDiffDays(a.date, b.date);
        if (dateDiff > tol) continue;
        const refVerdict = compareReference(
          [a.reference],
          b.reference,
          config.referencePartialMinLength,
        );
        const partyEqual =
          !!a.normalizedParty &&
          (a.normalizedParty === b.normalizedParty || a.ledger === b.ledger);
        if (refVerdict !== 'EXACT' && !partyEqual) continue;
        const built = pairEvidence(
          a.date,
          b.date,
          [a.reference],
          b.reference,
          a.normalizedParty ?? a.ledger,
          b.normalizedParty ?? b.ledger,
        );
        findings.push({
          tallyIds: [a.id, b.id],
          tallyId: a.id,
          matchType: 'DUPLICATE_CANDIDATE',
          status: 'REVIEW_REQUIRED',
          confidence: built.confidence,
          evidence: built.evidence,
          reason: describePair('within Tally transactions', a.amount, dateDiff),
          amountDifference: '0',
          dateDifferenceDays: dateDiff,
        });
      }
    }
  }

  // Cross-source: one bank row with 2+ tally rows sharing amount,
  // direction, window and exact reference (and the mirror image, skipping
  // tally rows already surfaced to avoid double coverage).
  const coveredTally = new Set<string>();
  for (const b of bank) {
    const hits = tally.filter((t) => {
      try {
        if (!new Decimal(t.amount).equals(new Decimal(b.amount))) return false;
      } catch {
        return false;
      }
      return (
        t.direction === b.direction &&
        dateDiffDays(b.date, t.date) <= tol &&
        compareReference(
          [b.reference, b.normalizedReference, b.chequeNumber],
          t.reference,
          config.referencePartialMinLength,
        ) === 'EXACT'
      );
    });
    if (hits.length >= 2) {
      const ids = hits.map((t) => t.id);
      ids.forEach((id) => coveredTally.add(id));
      const dateDiff = Math.max(
        ...hits.map((t) => dateDiffDays(b.date, t.date)),
      );
      const built = pairEvidence(
        b.date,
        hits[0]?.date as Date,
        [b.reference, b.normalizedReference, b.chequeNumber],
        hits[0]?.reference,
        b.normalizedNarration,
        hits[0]?.normalizedParty ?? hits[0]?.ledger,
      );
      findings.push({
        bankId: b.id,
        bankIds: [b.id],
        tallyIds: ids,
        tallyId: ids[0],
        matchType: 'DUPLICATE_CANDIDATE',
        status: 'REVIEW_REQUIRED',
        confidence: built.confidence,
        evidence: built.evidence,
        reason:
          `Possible cross-source duplicate: bank transaction matches ` +
          `${hits.length} Tally vouchers (same amount, direction, window, ` +
          `exact reference): human confirmation required.`,
        amountDifference: '0',
        dateDifferenceDays: dateDiff,
      });
    }
  }
  for (const t of tally) {
    if (coveredTally.has(t.id)) continue;
    const hits = bank.filter((b) => {
      try {
        if (!new Decimal(b.amount).equals(new Decimal(t.amount))) return false;
      } catch {
        return false;
      }
      return (
        b.direction === t.direction &&
        dateDiffDays(b.date, t.date) <= tol &&
        compareReference(
          [b.reference, b.normalizedReference, b.chequeNumber],
          t.reference,
          config.referencePartialMinLength,
        ) === 'EXACT'
      );
    });
    if (hits.length >= 2) {
      const ids = hits.map((b) => b.id);
      const dateDiff = Math.max(
        ...hits.map((b) => dateDiffDays(b.date, t.date)),
      );
      const built = pairEvidence(
        t.date,
        hits[0]?.date as Date,
        [t.reference],
        hits[0]?.reference ?? hits[0]?.normalizedReference,
        t.normalizedParty ?? t.ledger,
        hits[0]?.normalizedNarration,
      );
      findings.push({
        tallyId: t.id,
        tallyIds: [t.id],
        bankIds: ids,
        bankId: ids[0],
        matchType: 'DUPLICATE_CANDIDATE',
        status: 'REVIEW_REQUIRED',
        confidence: built.confidence,
        evidence: built.evidence,
        reason:
          `Possible cross-source duplicate: Tally voucher matches ` +
          `${hits.length} bank transactions (same amount, direction, window, ` +
          `exact reference): human confirmation required.`,
        amountDifference: '0',
        dateDifferenceDays: dateDiff,
      });
    }
  }

  return findings;
}

/**
 * Split matching over 1:1 leftovers. Phase A delegates to OneToOneStrategy
 * (strong matches consume first and are never reused); phase B searches
 * bounded amount-sum combinations in both directions; phase C appends
 * duplicate findings. Never auto-MATCHES a split; ambiguity → REVIEW.
 */
export class SplitMatchStrategy implements MatchingStrategy {
  readonly name = 'split-aware-one-to-one';

  constructor(
    private readonly split: SplitConfig = DEFAULT_SPLIT_CONFIG,
  ) {}

  match(
    bankRows: EngineBankRow[],
    tallyRows: EngineTallyRow[],
    config: MatchConfig = DEFAULT_MATCH_CONFIG,
  ): EngineOutcome {
    const base = new OneToOneStrategy().match(bankRows, tallyRows, config);
    const byBankId = new Map(bankRows.map((r) => [r.id, r]));
    const byTallyId = new Map(tallyRows.map((r) => [r.id, r]));
    const consumedBank = new Set<string>();
    const consumedTally = new Set<string>();
    for (const m of base.matches) {
      if (m.bankId && m.tallyId) {
        consumedBank.add(m.bankId);
        consumedTally.add(m.tallyId);
      }
    }

    const matches = [...base.matches];
    const supersede = (bankIds: string[], tallyIds: string[]) => {
      for (let i = matches.length - 1; i >= 0; i -= 1) {
        const m = matches[i] as EngineMatch;
        // Only base (1:1 engine) results are superseded. Split/duplicate
        // results carry matchType and must never remove each other — the
        // just-pushed ONE_TO_MANY split has bankId without tallyId and
        // would otherwise match its own removal criteria.
        const isBaseResult = !m.matchType || m.matchType === 'ONE_TO_ONE';
        if (!isBaseResult) continue;
        const hitBank =
          (m.bankId && bankIds.includes(m.bankId) && !m.tallyId) || false;
        const hitTally =
          (m.tallyId && tallyIds.includes(m.tallyId) && !m.bankId) || false;
        if (hitBank || hitTally) matches.splice(i, 1);
      }
    };

    const tol = config.dateToleranceDays;
    const roundingTol = new Decimal(this.split.roundingTolerance);

    // ONE_TO_MANY: one leftover bank row vs leftover tally parts.
    const leftoverBank = [...byBankId.values()].filter(
      (r) => !consumedBank.has(r.id),
    );
    for (const bank of leftoverBank) {
      const pool = [...byTallyId.values()]
        .filter(
          (t) =>
            !consumedTally.has(t.id) &&
            t.direction === bank.direction &&
            dateDiffDays(bank.date, t.date) <= tol,
        )
        .sort((a, b) => dateDiffDays(bank.date, a.date) - dateDiffDays(bank.date, b.date) || a.id.localeCompare(b.id))
        .slice(0, this.split.maxSplitPoolSize);
      if (pool.length < 2) continue;
      let target: Decimal;
      try {
        target = new Decimal(bank.amount);
      } catch {
        continue;
      }
      const parts: Part[] = [];
      for (const t of pool) {
        try {
          parts.push({
            key: t.id,
            amount: new Decimal(t.amount),
            date: t.date,
          });
        } catch {
          continue;
        }
      }
      const combos = findSplitCombos(
        target,
        parts,
        this.split.maxSplitItems,
        roundingTol,
        this.split.maxSubsetsEvaluated,
      );
      const ranked = this.rankCombos(bank, null, pool, combos, config);
      if (ranked.length === 0) continue;
      const [top, ...rest] = ranked;
      const ambiguous = rest.length > 0;
      matches.push(
        this.splitResult(
          'ONE_TO_MANY',
          [bank],
          top!.ids.map((id) => byTallyId.get(id) as EngineTallyRow),
          top!.ev,
          ambiguous,
          config,
        ),
      );
      supersede([bank.id], top!.ids);
      if (!ambiguous) {
        consumedBank.add(bank.id);
        top!.ids.forEach((id) => consumedTally.add(id));
      }
    }

    // MANY_TO_ONE: mirror image over leftover tally rows.
    const leftoverTally = [...byTallyId.values()].filter(
      (r) => !consumedTally.has(r.id),
    );
    for (const tally of leftoverTally) {
      const pool = [...byBankId.values()]
        .filter(
          (b) =>
            !consumedBank.has(b.id) &&
            b.direction === tally.direction &&
            dateDiffDays(b.date, tally.date) <= tol,
        )
        .sort((a, b) => dateDiffDays(tally.date, a.date) - dateDiffDays(tally.date, b.date) || a.id.localeCompare(b.id))
        .slice(0, this.split.maxSplitPoolSize);
      if (pool.length < 2) continue;
      let target: Decimal;
      try {
        target = new Decimal(tally.amount);
      } catch {
        continue;
      }
      const parts: Part[] = [];
      for (const b of pool) {
        try {
          parts.push({
            key: b.id,
            amount: new Decimal(b.amount),
            date: b.date,
          });
        } catch {
          continue;
        }
      }
      const combos = findSplitCombos(
        target,
        parts,
        this.split.maxSplitItems,
        roundingTol,
        this.split.maxSubsetsEvaluated,
      );
      const ranked = this.rankCombos(null, tally, pool, combos, config, true);
      if (ranked.length === 0) continue;
      const [top, ...rest] = ranked;
      const ambiguous = rest.length > 0;
      matches.push(
        this.splitResult(
          'MANY_TO_ONE',
          top!.ids.map((id) => byBankId.get(id) as EngineBankRow),
          [tally],
          top!.ev,
          ambiguous,
          config,
        ),
      );
      supersede(
        top!.ids,
        [tally.id],
      );
      if (!ambiguous) {
        consumedTally.add(tally.id);
        top!.ids.forEach((id) => consumedBank.add(id));
      }
    }

    for (const d of detectDuplicates(bankRows, tallyRows, config)) {
      matches.push(d);
    }
    return { matches };
  }

  private rankCombos(
    bank: EngineBankRow | null,
    tally: EngineTallyRow | null,
    pool: (EngineBankRow | EngineTallyRow)[],
    combos: string[][],
    config: MatchConfig,
    invert = false,
  ): { ids: string[]; ev: ComboEvidence; diff: Decimal }[] {
    const byId = new Map(pool.map((p) => [p.id, p]));
    const anchor = (bank ?? tally) as EngineBankRow & EngineTallyRow;
    const anchorAmount = new Decimal(
      (bank ? bank.amount : (tally as EngineTallyRow).amount) as string,
    );
    const scored = combos.map((ids) => {
      const parts = ids.map((id) => byId.get(id) as EngineBankRow & EngineTallyRow);
      const sum = parts.reduce(
        (acc, p) => acc.plus(new Decimal(p.amount)),
        new Decimal(0),
      );
      const diff = sum.minus(anchorAmount).abs();
      const verdicts = parts.map((p) => {
        if (!invert) {
          const b = anchor as EngineBankRow;
          const t = p as EngineTallyRow;
          return {
            date: dateDiffDays(b.date, t.date) === 0 ? ('EXACT' as const) : ('CLOSE' as const),
            party: compareParty(
              b.normalizedNarration,
              t.normalizedParty ?? t.ledger,
            ),
            reference: compareReference(
              [b.reference, b.normalizedReference, b.chequeNumber],
              t.reference,
              config.referencePartialMinLength,
            ),
          };
        }
        const t = anchor as EngineTallyRow;
        const b = p as EngineBankRow;
        return {
          date: dateDiffDays(b.date, t.date) === 0 ? ('EXACT' as const) : ('CLOSE' as const),
          party: compareParty(
            b.normalizedNarration,
            t.normalizedParty ?? t.ledger,
          ),
          reference: compareReference(
            [b.reference, b.normalizedReference, b.chequeNumber],
            t.reference,
            config.referencePartialMinLength,
          ),
        };
      });
      const ev = aggregateEvidence(verdicts);
      const maxDiff = Math.max(
        ...parts.map((p) =>
          invert
            ? dateDiffDays((p as EngineBankRow).date, (anchor as EngineTallyRow).date)
            : dateDiffDays(
                (anchor as EngineBankRow).date,
                (p as EngineTallyRow).date,
              ),
        ),
      );
      return { ids, ev: { ...ev, maxDateDiff: maxDiff }, diff };
    });
    scored.sort((a, b) => {
      if (!a.diff.equals(b.diff)) return a.diff.comparedTo(b.diff) as number;
      if (a.ev.refExactCount !== b.ev.refExactCount) {
        return b.ev.refExactCount - a.ev.refExactCount;
      }
      if (a.ev.partyMatchCount !== b.ev.partyMatchCount) {
        return b.ev.partyMatchCount - a.ev.partyMatchCount;
      }
      if (a.ev.maxDateDiff !== b.ev.maxDateDiff) {
        return a.ev.maxDateDiff - b.ev.maxDateDiff;
      }
      if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
      return a.ids.join(',').localeCompare(b.ids.join(','));
    });
    return scored;
  }

  private splitResult(
    matchType: EngineMatchType,
    banks: EngineBankRow[],
    tallies: EngineTallyRow[],
    ev: ComboEvidence,
    ambiguous: boolean,
    _config: MatchConfig,
  ): EngineMatch {
    void _config;
    const bankTotal = banks
      .reduce((acc, b) => acc.plus(new Decimal(b.amount)), new Decimal(0))
      .toString();
    const tallyTotal = tallies
      .reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0))
      .toString();
    const amountDifference = new Decimal(bankTotal)
      .minus(new Decimal(tallyTotal))
      .abs()
      .toString();
    const confidence = splitConfidence(ev);
    const status = ambiguous ? 'REVIEW_REQUIRED' : 'POSSIBLE_MATCH';
    const side =
      matchType === 'ONE_TO_MANY'
        ? `Bank ${bankTotal} matches ${tallies.length} Tally transactions totalling ${tallyTotal}`
        : `${banks.length} bank transactions totalling ${bankTotal} match Tally ${tallyTotal}`;
    return {
      bankId: banks[0]?.id,
      tallyId: matchType === 'MANY_TO_ONE' ? tallies[0]?.id : undefined,
      bankIds: banks.map((b) => b.id),
      tallyIds: tallies.map((t) => t.id),
      matchType,
      bankTotal,
      tallyTotal,
      status,
      confidence,
      evidence: {
        amount: 'MATCH',
        direction: 'MATCH',
        date: ev.date,
        party: ev.party,
        reference: ev.reference,
      },
      reason:
        `${ambiguous ? 'Ambiguous split — needs review' : 'Possible split match'} ` +
        `(${matchType === 'ONE_TO_MANY' ? 'one-to-many' : 'many-to-one'}): ${side}; ` +
        `date ${ev.date.toLowerCase()}, party ${ev.party.toLowerCase()}, ` +
        `reference ${ev.reference.toLowerCase()}.`,
      amountDifference,
      dateDifferenceDays: ev.maxDateDiff,
    };
  }
}
