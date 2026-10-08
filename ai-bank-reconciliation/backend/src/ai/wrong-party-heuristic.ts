import { levenshtein, similarity } from '../common/fuzzy.js';
import type { AiTransactionInput } from './ai-provider.js';

/**
 * Analyze an AI request for a WRONG_PARTY_CANDIDATE without an LLM —
 * used as the deterministic fallback when the provider is unavailable and
 * as the first check in heuristics tests. Never declares anything confirmed.
 */
export function heuristicWrongParty(
  input: AiTransactionInput,
): { likely: boolean; reason: string } {
  const d = input.deterministic;
  if (d.evidence['party'] !== 'MISMATCH') {
    return { likely: false, reason: 'party evidence is not MISMATCH' };
  }
  const amountOk =
    d.evidence['amount'] === 'MATCH' &&
    (input.tally === null ||
      input.bank.amount === input.tally?.amount);
  if (!amountOk) {
    return { likely: false, reason: 'amounts do not match' };
  }
  const bankNarr = (input.bank.normalizedNarration ?? '').split(' ')[0] ?? '';
  const tallyParty = input.tally?.normalizedParty ?? '';
  if (!tallyParty || !bankNarr) {
    return { likely: false, reason: 'missing party evidence' };
  }
  const sim = similarity(bankNarr, tallyParty.split(' ')[0] ?? '');
  if (sim > 0.8 && levenshtein(bankNarr, tallyParty) > 0) {
    return { likely: false, reason: 'party names are near-identical variants' };
  }
  return {
    likely: true,
    reason:
      'Bank narration references a different party than the Tally posting; ' +
      'amount matches and dates are close. Possible wrong party — accountant review required.',
  };
}
