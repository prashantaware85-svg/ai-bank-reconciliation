import { describe, expect, it } from 'vitest';
import {
  runReconciliation,
  type EngineBankRow,
  type EngineMatch,
  type EngineTallyRow,
} from './engine.js';
import { DEFAULT_MATCH_CONFIG } from './match-config.js';
import { Decimal } from 'decimal.js';
import {
  SplitMatchStrategy,
  detectDuplicates,
  findSplitCombos,
} from './splits.js';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function bank(over: Partial<EngineBankRow> & { id: string }): EngineBankRow {
  return {
    date: D('2026-09-18'),
    amount: '100000',
    direction: 'DEBIT',
    normalizedNarration: 'ABC TRADERS',
    ...over,
  };
}

function tally(over: Partial<EngineTallyRow> & { id: string }): EngineTallyRow {
  return {
    date: D('2026-09-18'),
    amount: '100000',
    direction: 'DEBIT',
    normalizedParty: 'ABC TRADERS',
    ...over,
  };
}

const cfg = { ...DEFAULT_MATCH_CONFIG, dateToleranceDays: 2 };
const splitRun = (
  b: EngineBankRow[],
  t: EngineTallyRow[],
  strategy = new SplitMatchStrategy(),
) => runReconciliation(b, t, strategy, cfg);

const splitsOf = (matches: EngineMatch[], type: string) =>
  matches.filter((m) => m.matchType === type);

describe('split matching', () => {
  it('1. bank 100k ↔ tally 60k + 40k → ONE_TO_MANY POSSIBLE_MATCH', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1' })],
      [
        tally({ id: 't1', date: D('2026-09-17'), amount: '60000' }),
        tally({ id: 't2', amount: '40000' }),
      ],
    );
    const splits = splitsOf(matches, 'ONE_TO_MANY');
    expect(splits).toHaveLength(1);
    expect(splits[0]).toMatchObject({
      status: 'POSSIBLE_MATCH',
      bankTotal: '100000',
      tallyTotal: '100000',
      amountDifference: '0',
    });
    expect(splits[0]?.tallyIds?.sort()).toEqual(['t1', 't2']);
    expect(splits[0]?.status).not.toBe('MATCHED');
  });

  it('2. bank 40k + 60k ↔ tally 100k → MANY_TO_ONE POSSIBLE_MATCH', () => {
    const { matches } = splitRun(
      [
        bank({ id: 'b1', amount: '40000' }),
        bank({ id: 'b2', amount: '60000' }),
      ],
      [tally({ id: 't1' })],
    );
    const splits = splitsOf(matches, 'MANY_TO_ONE');
    expect(splits).toHaveLength(1);
    expect(splits[0]?.status).toBe('POSSIBLE_MATCH');
    expect(splits[0]?.bankIds?.sort()).toEqual(['b1', 'b2']);
    expect(splits[0]?.tallyTotal).toBe('100000');
  });

  it('3. exact split totals record zero difference', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1' })],
      [
        tally({ id: 't1', amount: '60000' }),
        tally({ id: 't2', amount: '40000' }),
      ],
    );
    const split = splitsOf(matches, 'ONE_TO_MANY')[0];
    expect(split?.amountDifference).toBe('0');
    expect(split?.evidence.amount).toBe('MATCH');
  });

  it('4. non-summing parts produce no split', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1' })],
      [
        tally({ id: 't1', amount: '60000' }),
        tally({ id: 't2', amount: '30000' }),
      ],
    );
    expect(splitsOf(matches, 'ONE_TO_MANY')).toHaveLength(0);
    expect(splitsOf(matches, 'MANY_TO_ONE')).toHaveLength(0);
  });

  it('5. split parts within tolerance link with CLOSE date', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1', date: D('2026-09-18') })],
      [
        tally({ id: 't1', date: D('2026-09-16'), amount: '60000' }),
        tally({ id: 't2', date: D('2026-09-20'), amount: '40000' }),
      ],
    );
    const split = splitsOf(matches, 'ONE_TO_MANY')[0];
    expect(split?.status).toBe('POSSIBLE_MATCH');
    expect(split?.evidence.date).toBe('CLOSE');
    expect(split?.dateDifferenceDays).toBe(2);
  });

  it('6. split parts outside tolerance do not combine', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1', date: D('2026-09-18') })],
      [
        tally({ id: 't1', date: D('2026-09-10'), amount: '60000' }),
        tally({ id: 't2', amount: '40000' }),
      ],
    );
    // t1 is outside the window; only t2 (40k) is eligible — no full combo.
    expect(splitsOf(matches, 'ONE_TO_MANY')).toHaveLength(0);
  });

  it('7. opposite direction parts never combine', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1', direction: 'DEBIT' })],
      [
        tally({ id: 't1', amount: '60000', direction: 'CREDIT' }),
        tally({ id: 't2', amount: '40000', direction: 'CREDIT' }),
      ],
    );
    expect(splitsOf(matches, 'ONE_TO_MANY')).toHaveLength(0);
    expect(splitsOf(matches, 'MANY_TO_ONE')).toHaveLength(0);
  });

  it('8. ambiguous combinations stay REVIEW_REQUIRED', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1' })],
      [
        tally({ id: 't1', amount: '60000' }),
        tally({ id: 't2', amount: '40000' }),
        tally({ id: 't3', amount: '50000' }),
        tally({ id: 't4', amount: '50000' }),
      ],
    );
    const splits = splitsOf(matches, 'ONE_TO_MANY');
    expect(splits).toHaveLength(1);
    expect(splits[0]?.status).toBe('REVIEW_REQUIRED');
    expect(splits[0]?.reason).toMatch('Ambiguous');
  });

  it('9. combinatorial explosion is capped and fast', () => {
    const parts: EngineTallyRow[] = Array.from({ length: 30 }, (_, i) =>
      tally({ id: `t${i}`, amount: '10' }),
    );
    const strategy = new SplitMatchStrategy({
      maxSplitItems: 5,
      maxSplitPoolSize: 30,
      maxSubsetsEvaluated: 500,
      roundingTolerance: '0',
    });
    const start = Date.now();
    const { matches } = runReconciliation(
      [bank({ id: 'b1', amount: '50' })],
      parts,
      strategy,
      cfg,
    );
    expect(Date.now() - start).toBeLessThan(5000);
    expect(Array.isArray(matches)).toBe(true);
  });

  it('10. strongly matched rows are never reused in splits', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1', reference: 'UTR1', normalizedNarration: 'ABC TRADERS' })],
      [
        tally({
          id: 't0',
          amount: '100000',
          reference: 'UTR1',
          normalizedParty: 'ABC TRADERS',
        }),
        tally({ id: 't1', amount: '60000' }),
        tally({ id: 't2', amount: '40000' }),
      ],
    );
    const strong = matches.filter(
      (m) => m.bankId === 'b1' && m.tallyId === 't0',
    );
    expect(strong).toHaveLength(1);
    expect(strong[0]?.status).toBe('MATCHED');
    expect(splitsOf(matches, 'ONE_TO_MANY')).toHaveLength(0);
  });

  it('16. decimal split amounts sum exactly', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1', amount: '100.50' })],
      [
        tally({ id: 't1', amount: '60.25' }),
        tally({ id: 't2', amount: '40.25' }),
      ],
    );
    const split = splitsOf(matches, 'ONE_TO_MANY')[0];
    expect(split?.amountDifference).toBe('0');
    expect(split?.tallyTotal).toBe('100.5');
  });

  it('findSplitCombos respects item and budget caps', () => {
    const parts = Array.from({ length: 8 }, (_, i) => ({
      key: `p${i}`,
      amount: new Decimal(10),
      date: D('2026-09-18'),
    }));
    const combos = findSplitCombos(
      new Decimal(30),
      parts,
      3,
      new Decimal(0),
      100000,
    );
    expect(combos.length).toBeGreaterThan(0);
    expect(
      combos.every((c) => c.length >= 2 && c.length <= 3),
    ).toBe(true);
  });
});

describe('duplicate candidates', () => {
  it('11. duplicate bank transactions surface with evidence', () => {
    const rows = [
      bank({
        id: 'b1',
        amount: '25000',
        reference: 'UTR123',
        normalizedNarration: 'NEFT ABC',
      }),
      bank({
        id: 'b2',
        amount: '25000',
        reference: 'UTR123',
        normalizedNarration: 'NEFT ABC',
      }),
    ];
    const { matches } = splitRun(rows, []);
    const dups = splitsOf(matches, 'DUPLICATE_CANDIDATE');
    expect(dups).toHaveLength(1);
    expect(dups[0]?.bankIds?.sort()).toEqual(['b1', 'b2']);
    expect(dups[0]?.status).toBe('REVIEW_REQUIRED');
    expect(dups[0]?.evidence).toMatchObject({
      amount: 'MATCH',
      direction: 'MATCH',
      reference: 'EXACT',
    });
  });

  it('12. duplicate tally transactions surface with evidence', () => {
    const { matches } = splitRun(
      [],
      [
        tally({ id: 't1', reference: 'UTR9', normalizedParty: 'ABC' }),
        tally({ id: 't2', reference: 'UTR9', normalizedParty: 'ABC' }),
      ],
    );
    const dups = splitsOf(matches, 'DUPLICATE_CANDIDATE');
    expect(dups).toHaveLength(1);
    expect(dups[0]?.tallyIds?.sort()).toEqual(['t1', 't2']);
  });

  it('13. one bank row matching two tally rows surfaces cross-source duplicate', () => {
    const { matches } = splitRun(
      [bank({ id: 'b1', reference: 'UTR123' })],
      [
        tally({ id: 't1', voucherNo: '101', reference: 'UTR123' }),
        tally({ id: 't2', voucherNo: '102', reference: 'UTR123' }),
      ],
    );
    const dups = splitsOf(matches, 'DUPLICATE_CANDIDATE').filter(
      (m) => m.bankIds?.includes('b1'),
    );
    expect(dups).toHaveLength(1);
    expect(dups[0]?.tallyIds?.sort()).toEqual(['t1', 't2']);
  });

  it('14. same amount but different reference and party is not a duplicate', () => {
    const { matches } = splitRun(
      [
        bank({
          id: 'b1',
          reference: 'UTR1',
          normalizedNarration: 'NEFT ABC',
        }),
        bank({
          id: 'b2',
          reference: 'UTR2',
          normalizedNarration: 'NEFT XYZ',
        }),
      ],
      [],
    );
    expect(splitsOf(matches, 'DUPLICATE_CANDIDATE')).toHaveLength(0);
  });

  it('15. same reference but different amount is not a duplicate', () => {
    const { matches } = splitRun(
      [
        bank({ id: 'b1', amount: '50000', reference: 'UTR123' }),
        bank({ id: 'b2', amount: '60000', reference: 'UTR123' }),
      ],
      [],
    );
    expect(splitsOf(matches, 'DUPLICATE_CANDIDATE')).toHaveLength(0);
  });

  it('detectDuplicates runs standalone over loaded rows', () => {
    const findings = detectDuplicates(
      [bank({ id: 'b1', reference: 'UTR1' })],
      [tally({ id: 't1', reference: 'UTR1' })],
      cfg,
    );
    expect(Array.isArray(findings)).toBe(true);
  });
});
