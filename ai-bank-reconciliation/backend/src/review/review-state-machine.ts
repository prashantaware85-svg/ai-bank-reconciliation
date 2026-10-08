import type { ReviewActionType } from '../generated/prisma/client.js';

export type ReviewStatusValue =
  | 'PENDING_REVIEW'
  | 'IN_REVIEW'
  | 'CONFIRMED_MATCH'
  | 'WRONG_PARTY'
  | 'DUPLICATE_CONFIRMED'
  | 'AMOUNT_MISMATCH_CONFIRMED'
  | 'DATE_MISMATCH_CONFIRMED'
  | 'MISSING_IN_TALLY_CONFIRMED'
  | 'MISSING_IN_BANK_CONFIRMED'
  | 'REJECTED'
  | 'IGNORED'
  | 'CORRECTION_REQUIRED';

const TERMINAL: ReviewStatusValue[] = [
  'CONFIRMED_MATCH',
  'WRONG_PARTY',
  'DUPLICATE_CONFIRMED',
  'AMOUNT_MISMATCH_CONFIRMED',
  'DATE_MISMATCH_CONFIRMED',
  'MISSING_IN_TALLY_CONFIRMED',
  'MISSING_IN_BANK_CONFIRMED',
  'REJECTED',
  'IGNORED',
  'CORRECTION_REQUIRED',
];

/**
 * Explicit review state machine (Step 10). Deterministic; invalid
 * transitions are rejected with 409 by the caller.
 *
 * PENDING_REVIEW → IN_REVIEW → terminal decision
 * PENDING_REVIEW → IGNORED
 * terminal → REOPEN → IN_REVIEW
 */
export const TRANSITIONS: Record<
  ReviewActionType,
  { from: ReviewStatusValue[]; to: ReviewStatusValue }
> = {
  START_REVIEW: {
    from: ['PENDING_REVIEW', 'REJECTED'],
    to: 'IN_REVIEW',
  },
  CONFIRM_MATCH: { from: ['IN_REVIEW'], to: 'CONFIRMED_MATCH' },
  CONFIRM_WRONG_PARTY: { from: ['IN_REVIEW'], to: 'WRONG_PARTY' },
  CONFIRM_DUPLICATE: { from: ['IN_REVIEW'], to: 'DUPLICATE_CONFIRMED' },
  CONFIRM_AMOUNT_MISMATCH: {
    from: ['IN_REVIEW'],
    to: 'AMOUNT_MISMATCH_CONFIRMED',
  },
  CONFIRM_DATE_MISMATCH: { from: ['IN_REVIEW'], to: 'DATE_MISMATCH_CONFIRMED' },
  CONFIRM_MISSING_IN_TALLY: {
    from: ['IN_REVIEW'],
    to: 'MISSING_IN_TALLY_CONFIRMED',
  },
  CONFIRM_MISSING_IN_BANK: {
    from: ['IN_REVIEW'],
    to: 'MISSING_IN_BANK_CONFIRMED',
  },
  REJECT: { from: ['IN_REVIEW'], to: 'REJECTED' },
  IGNORE: { from: ['PENDING_REVIEW', 'IN_REVIEW'], to: 'IGNORED' },
  REOPEN: { from: TERMINAL, to: 'IN_REVIEW' },
};

/** Decisions that require a comment (CONFIRM_MATCH is optional). */
export const COMMENT_REQUIRED: ReviewActionType[] = [
  'CONFIRM_WRONG_PARTY',
  'CONFIRM_DUPLICATE',
  'CONFIRM_AMOUNT_MISMATCH',
  'CONFIRM_DATE_MISMATCH',
  'CONFIRM_MISSING_IN_TALLY',
  'CONFIRM_MISSING_IN_BANK',
  'REJECT',
  'IGNORE',
];

export function transitionFor(
  action: ReviewActionType,
  current: ReviewStatusValue,
): ReviewStatusValue | undefined {
  const rule = TRANSITIONS[action];
  if (!rule) return undefined;
  if (!rule.from.includes(current)) return undefined;
  return rule.to;
}

export function isTerminal(status: ReviewStatusValue): boolean {
  return TERMINAL.includes(status);
}

/** Actions currently available given the status (for UI + validation). */
export function availableActions(current: ReviewStatusValue): ReviewActionType[] {
  return (Object.keys(TRANSITIONS) as ReviewActionType[]).filter(
    (action) => transitionFor(action, current) !== undefined,
  );
}
