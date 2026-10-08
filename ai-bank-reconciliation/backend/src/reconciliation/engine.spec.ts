import { describe, expect, it } from 'vitest';
import {
  OneToOneStrategy,
  runReconciliation as runWithStrategy,
  type EngineBankRow,
  type EngineTallyRow,
} from './engine.js';
import { DEFAULT_MATCH_CONFIG } from './match-config.js';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function bank(over: Partial<EngineBankRow> & { id: string }): EngineBankRow {
  return {
    date: D('2026-09-18'),
    amount: '75000',
    direction: 'DEBIT',
    ...over,
  };
}

function tally(over: Partial<EngineTallyRow> & { id: string }): EngineTallyRow {
  return {
    date: D('2026-09-18'),
    amount: '75000',
    direction: 'DEBIT',
    ...over,
  };
}

const cfg = { ...DEFAULT_MATCH_CONFIG, dateToleranceDays: 2 };

const runReconciliation = (
  bank: EngineBankRow[],
  tally: EngineTallyRow[],
  config = cfg,
) => runWithStrategy(bank, tally, new OneToOneStrategy(), config);

describe('reconciliation engine', () => {
  it('1. exact reference match → MATCHED with full evidence', () => {
    const { matches } = runReconciliation(
      [
        bank({
          id: 'b1',
          reference: 'UTR123',
          normalizedNarration: 'ABC TRADERS',
        }),
      ],
      [
        tally({
          id: 't1',
          reference: 'UTR123',
          normalizedParty: 'ABC TRADERS',
        }),
      ],
      cfg,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      bankId: 'b1',
      tallyId: 't1',
      status: 'MATCHED',
      confidence: 100,
      amountDifference: '0',
      dateDifferenceDays: 0,
    });
    expect(matches[0]?.evidence).toMatchObject({
      amount: 'MATCH',
      direction: 'MATCH',
      date: 'EXACT',
      party: 'MATCH',
      reference: 'EXACT',
    });
    expect(matches[0]?.reason).toContain('Matched');
  });

  it('2. exact amount + party + date without reference → REVIEW_REQUIRED', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', normalizedNarration: 'ABC TRADERS' })],
      [tally({ id: 't1', normalizedParty: 'ABC TRADERS' })],
      cfg,
    );
    expect(matches[0]?.status).toBe('REVIEW_REQUIRED');
    expect(matches[0]?.confidence).toBe(65);
  });

  it('3. close date still matches with day difference recorded', () => {
    const { matches } = runReconciliation(
      [
        bank({
          id: 'b1',
          reference: 'UTR1',
          normalizedNarration: 'ABC TRADERS',
        }),
      ],
      [
        tally({
          id: 't1',
          date: D('2026-09-17'),
          reference: 'UTR1',
          normalizedParty: 'ABC TRADERS',
        }),
      ],
      cfg,
    );
    expect(matches[0]?.status).toBe('MATCHED');
    expect(matches[0]?.dateDifferenceDays).toBe(1);
    expect(matches[0]?.evidence.date).toBe('CLOSE');
  });

  it('4. amount mismatch with exact reference → AMOUNT_MISMATCH', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR9', amount: '75000' })],
      [tally({ id: 't1', reference: 'UTR9', amount: '74500' })],
      cfg,
    );
    expect(matches[0]?.status).toBe('AMOUNT_MISMATCH');
    expect(matches[0]?.amountDifference).toBe('500');
    expect(matches[0]?.tallyId).toBe('t1');
  });

  it('5. strong evidence outside tolerance → DATE_MISMATCH', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR7' })],
      [tally({ id: 't1', date: D('2026-09-28'), reference: 'UTR7' })],
      cfg,
    );
    expect(matches[0]?.status).toBe('DATE_MISMATCH');
    expect(matches[0]?.dateDifferenceDays).toBe(10);
  });

  it('6. opposite directions never match', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR5', direction: 'DEBIT' })],
      [tally({ id: 't1', reference: 'UTR5', direction: 'CREDIT' })],
      cfg,
    );
    expect(matches[0]?.status).toBe('UNMATCHED');
    expect(matches[0]?.tallyId).toBeUndefined();
  });

  it('7. bank row with no tally rows → MISSING_IN_TALLY', () => {
    const { matches } = runReconciliation([bank({ id: 'b1' })], [], cfg);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.status).toBe('MISSING_IN_TALLY');
  });

  it('8. tally row with no bank rows → MISSING_IN_BANK', () => {
    const { matches } = runReconciliation([], [tally({ id: 't1' })], cfg);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.status).toBe('MISSING_IN_BANK');
  });

  it('9. nearby activity without evidence → UNMATCHED', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', amount: '1000' })],
      [tally({ id: 't1', amount: '9999' })],
      cfg,
    );
    expect(matches[0]?.status).toBe('UNMATCHED');
  });

  it('10. duplicate tally candidates are consumed only once', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR2', normalizedNarration: 'ABC TRADERS' })],
      [
        tally({ id: 't1', reference: 'UTR2', normalizedParty: 'ABC TRADERS' }),
        tally({ id: 't2', reference: 'UTR2', normalizedParty: 'ABC TRADERS' }),
      ],
      cfg,
    );
    const linked = matches.filter(
      (m) => m.bankId !== undefined && m.tallyId !== undefined,
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]?.status).toBe('MATCHED');
    // The second identical tally row is reported (not silently consumed).
    const leftover = matches.find((m) => m.tallyId === 't2');
    expect(leftover?.status).toBe('UNMATCHED');
    expect(leftover?.bankId).toBeUndefined();
  });

  it('11. partial party overlap → REVIEW_REQUIRED with PARTIAL evidence', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', normalizedNarration: 'ABC TRADERS MUMBAI' })],
      [tally({ id: 't1', normalizedParty: 'ABC TRADERS' })],
      cfg,
    );
    expect(matches[0]?.status).toBe('REVIEW_REQUIRED');
    expect(matches[0]?.evidence.party).toBe('PARTIAL');
  });

  it('12. partial reference overlap → REVIEW_REQUIRED', () => {
    const { matches } = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR12345' })],
      [tally({ id: 't1', reference: 'UTR123' })],
      cfg,
    );
    expect(matches[0]?.evidence.reference).toBe('PARTIAL');
    expect(matches[0]?.status).toBe('REVIEW_REQUIRED');
  });

  it('13. decimal spellings of the same amount match exactly', () => {
    const { matches } = runReconciliation(
      [
        bank({
          id: 'b1',
          amount: '75000.00',
          reference: 'UTR3',
          normalizedNarration: 'ABC TRADERS',
        }),
      ],
      [
        tally({
          id: 't1',
          amount: '75000',
          reference: 'UTR3',
          normalizedParty: 'ABC TRADERS',
        }),
      ],
      cfg,
    );
    expect(matches[0]?.status).toBe('MATCHED');
    expect(matches[0]?.amountDifference).toBe('0');
  });

  it('14. tolerance boundary: inside matches, outside mismatches date', () => {
    const inside = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR4', normalizedNarration: 'ABC' })],
      [
        tally({
          id: 't1',
          date: D('2026-09-20'),
          reference: 'UTR4',
          normalizedParty: 'ABC',
        }),
      ],
      cfg,
    );
    expect(inside.matches[0]?.status).toBe('MATCHED');

    const outside = runReconciliation(
      [bank({ id: 'b1', reference: 'UTR4', normalizedNarration: 'ABC' })],
      [
        tally({
          id: 't1',
          date: D('2026-09-21'),
          reference: 'UTR4',
          normalizedParty: 'ABC',
        }),
      ],
      cfg,
    );
    expect(outside.matches[0]?.status).toBe('DATE_MISMATCH');
  });

  it('16. a tally row is never consumed twice', () => {
    const { matches } = runReconciliation(
      [
        bank({ id: 'b1', reference: 'UTR6', normalizedNarration: 'ABC' }),
        bank({ id: 'b2', reference: 'UTR6', normalizedNarration: 'ABC' }),
      ],
      [tally({ id: 't1', reference: 'UTR6', normalizedParty: 'ABC' })],
      cfg,
    );
    const linked = matches.filter((m) => m.tallyId === 't1');
    expect(linked).toHaveLength(1);
    expect(linked[0]?.status).toBe('MATCHED');
    const other = matches.find((m) => m.bankId === 'b2');
    expect(other?.tallyId).toBeUndefined();
    expect(other?.status).toBe('UNMATCHED');
  });

  it('strong party contradiction vetoes automatic matching', () => {
    const { matches } = runReconciliation(
      [
        bank({
          id: 'b1',
          reference: 'UTR8',
          normalizedNarration: 'ABC TRADERS',
        }),
      ],
      [
        tally({
          id: 't1',
          reference: 'UTR8',
          normalizedParty: 'XYZ TRADERS',
        }),
      ],
      cfg,
    );
    expect(matches[0]?.evidence.party).toBe('MISMATCH');
    expect(matches[0]?.status).not.toBe('MATCHED');
  });
});
