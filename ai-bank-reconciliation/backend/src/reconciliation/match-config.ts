/**
 * Matching configuration. These weights are application defaults for
 * calibration — NOT accounting standards. Tune via MatchConfig overrides.
 */
export interface MatchConfig {
  dateToleranceDays: number;
  weights: {
    reference: number;
    referencePartial: number;
    amount: number;
    party: number;
    partyPartial: number;
    date: number;
    dateClose: number;
  };
  bands: {
    /** >= matchedMin → MATCHED */
    matchedMin: number;
    /** >= strongPossibleMin with strong evidence → MATCHED, else POSSIBLE_MATCH */
    strongPossibleMin: number;
    /** >= possibleMin → POSSIBLE_MATCH */
    possibleMin: number;
    /** >= reviewMin → REVIEW_REQUIRED, else UNMATCHED */
    reviewMin: number;
  };
  /** Minimum overlap length for a PARTIAL reference verdict. */
  referencePartialMinLength: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  dateToleranceDays: 2,
  weights: {
    reference: 35,
    referencePartial: 15,
    amount: 35,
    party: 20,
    partyPartial: 10,
    date: 10,
    dateClose: 5,
  },
  bands: {
    matchedMin: 95,
    strongPossibleMin: 85,
    possibleMin: 70,
    reviewMin: 50,
  },
  referencePartialMinLength: 4,
};
