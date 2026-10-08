import { describe, expect, it } from 'vitest';
import type { AiTransactionInput } from './ai-provider.js';
import { heuristicWrongParty } from './wrong-party-heuristic.js';

/**
 * Deterministic synthetic evaluation dataset (Step 14 §16).
 * No real customer data. Each case states the expected classification
 * a capable provider should produce; the table below scores the
 * deterministic fallback heuristic honestly — it is NOT a claim about
 * any real LLM's accuracy.
 */
interface EvalCase {
  name: string;
  input: AiTransactionInput;
  expected: string;
}

function base(): AiTransactionInput {
  return {
    bank: {
      date: '2026-09-18',
      amount: '75000',
      direction: 'DEBIT',
      narration: 'NEFT ABC TRADERS',
      reference: 'HDFC123456',
      normalizedNarration: 'NEFT ABC TRADERS',
    },
    tally: {
      date: '2026-09-18',
      amount: '75000',
      direction: 'DEBIT',
      party: 'ABC Traders',
      ledger: 'ABC Traders',
      narration: 'NEFT ABC Traders',
      reference: 'HDFC123456',
      normalizedParty: 'ABC TRADERS',
    },
    deterministic: {
      matchStatus: 'MATCHED',
      matchType: 'ONE_TO_ONE',
      confidence: 100,
      amountDifference: '0',
      dateDifferenceDays: 0,
      evidence: {
        amount: 'MATCH',
        date: 'EXACT',
        party: 'MATCH',
        reference: 'EXACT',
      },
    },
    fuzzy: { narration: 1, party: 1, reference: 1 },
  };
}

const CASES: EvalCase[] = [
  {
    name: '1. exact match',
    input: base(),
    expected: 'NO_EXCEPTION',
  },
  {
    name: '2. wrong party',
    input: {
      ...base(),
      tally: {
        ...base().tally!,
        party: 'XYZ Traders',
        ledger: 'XYZ Traders',
        reference: undefined,
        normalizedParty: 'XYZ TRADERS',
      },
      deterministic: {
        ...base().deterministic,
        matchStatus: 'REVIEW_REQUIRED',
        evidence: { amount: 'MATCH', date: 'CLOSE', party: 'MISMATCH', reference: 'MISSING' },
      },
    },
    expected: 'WRONG_PARTY_CANDIDATE',
  },
  {
    name: '3. duplicate (same ref, same amount, close date)',
    input: {
      ...base(),
      deterministic: {
        ...base().deterministic,
        matchStatus: 'REVIEW_REQUIRED',
        evidence: { amount: 'MATCH', date: 'EXACT', party: 'MATCH', reference: 'EXACT' },
      },
    },
    expected: 'DUPLICATE_CANDIDATE',
  },
  {
    name: '4. amount mismatch',
    input: {
      ...base(),
      tally: { ...base().tally!, amount: '70000' },
      deterministic: {
        ...base().deterministic,
        matchStatus: 'AMOUNT_MISMATCH',
        amountDifference: '5000',
        evidence: { amount: 'MISMATCH', date: 'EXACT', party: 'MATCH', reference: 'EXACT' },
      },
    },
    expected: 'AMOUNT_ANOMALY',
  },
  {
    name: '5. date mismatch',
    input: {
      ...base(),
      tally: { ...base().tally!, date: '2026-09-20' },
      deterministic: {
        ...base().deterministic,
        matchStatus: 'DATE_MISMATCH',
        dateDifferenceDays: 2,
        evidence: { amount: 'MATCH', date: 'FAR', party: 'MATCH', reference: 'EXACT' },
      },
    },
    expected: 'DATE_ANOMALY',
  },
  {
    name: '6. missing in Tally',
    input: {
      ...base(),
      tally: null,
      deterministic: {
        ...base().deterministic,
        matchStatus: 'MISSING_IN_TALLY',
        evidence: { amount: 'MISMATCH', date: 'FAR', party: 'UNKNOWN', reference: 'MISSING' },
      },
    },
    expected: 'REVIEW_REQUIRED',
  },
  {
    name: '7. missing in bank',
    input: {
      ...base(),
      bank: {
        date: '',
        amount: '',
        direction: '',
      },
      deterministic: {
        ...base().deterministic,
        matchStatus: 'MISSING_IN_BANK',
        evidence: { amount: 'MISMATCH', date: 'FAR', party: 'UNKNOWN', reference: 'MISSING' },
      },
    },
    expected: 'REVIEW_REQUIRED',
  },
  {
    name: '8. bank charge',
    input: {
      ...base(),
      bank: {
        date: '2026-09-18',
        amount: '590',
        direction: 'DEBIT',
        narration: 'BANK CHARGES',
        normalizedNarration: 'BANK CHARGES',
      },
      tally: null,
      deterministic: {
        ...base().deterministic,
        matchStatus: 'MISSING_IN_TALLY',
        evidence: { amount: 'MISMATCH', date: 'FAR', party: 'UNKNOWN', reference: 'MISSING' },
      },
    },
    expected: 'NO_EXCEPTION',
  },
  {
    name: '9. interest candidate',
    input: {
      ...base(),
      bank: {
        date: '2026-09-30',
        amount: '1250',
        direction: 'CREDIT',
        narration: 'INT PD:SB ACCOUNT',
        normalizedNarration: 'INT PD SB ACCOUNT',
      },
      tally: null,
      deterministic: {
        ...base().deterministic,
        matchStatus: 'MISSING_IN_TALLY',
        evidence: { amount: 'MISMATCH', date: 'FAR', party: 'UNKNOWN', reference: 'MISSING' },
      },
    },
    expected: 'NO_EXCEPTION',
  },
  {
    name: '10. ambiguous (partial everything)',
    input: {
      ...base(),
      bank: {
        ...base().bank,
        reference: 'HDFC999',
        normalizedNarration: 'NEFT ABC TRADERS MUMBAI',
      },
      tally: {
        ...base().tally!,
        party: 'ABC TRADING CO',
        normalizedParty: 'ABC TRADING CO',
      },
      deterministic: {
        ...base().deterministic,
        matchStatus: 'REVIEW_REQUIRED',
        evidence: { amount: 'MATCH', date: 'CLOSE', party: 'PARTIAL', reference: 'PARTIAL' },
      },
    },
    expected: 'REVIEW_REQUIRED',
  },
];

function fallbackClassification(c: EvalCase): string {
  const h = heuristicWrongParty(c.input);
  return h.likely ? 'WRONG_PARTY_CANDIDATE' : 'NO_EXCEPTION';
}

describe('synthetic evaluation table (fallback heuristic, honest scoring)', () => {
  it('scores all 10 cases without throwing and reports accuracy', () => {
    const rows = CASES.map((c) => {
      let got: string;
      try {
        got = fallbackClassification(c);
      } catch {
        got = 'ERROR';
      }
      return { case: c.name, expected: c.expected, got, correct: got === c.expected };
    });
    const correct = rows.filter((r) => r.correct).length;
    // eslint-disable-next-line no-console
    console.log(
      ['case|expected|fallback|correct', ...rows.map((r) => `${r.case}|${r.expected}|${r.got}|${r.correct}`)].join('\n'),
    );
    // eslint-disable-next-line no-console
    console.log(`fallback accuracy on synthetic set: ${correct}/${rows.length}`);
    expect(rows).toHaveLength(10);
    // The fallback is intentionally narrow (wrong-party only): it must get
    // the exact-match and wrong-party cases right and stay safe elsewhere.
    expect(rows.find((r) => r.case.startsWith('1.'))?.correct).toBe(true);
    expect(rows.find((r) => r.case.startsWith('2.'))?.correct).toBe(true);
    // No case may throw or produce an out-of-enum classification.
    const allowed = new Set([
      'NO_EXCEPTION',
      'WRONG_PARTY_CANDIDATE',
      'DUPLICATE_CANDIDATE',
      'AMOUNT_ANOMALY',
      'DATE_ANOMALY',
      'NARRATION_ANOMALY',
      'REVIEW_REQUIRED',
    ]);
    for (const r of rows) {
      expect(allowed.has(r.got)).toBe(true);
    }
  });
});
