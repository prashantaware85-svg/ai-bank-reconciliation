import { describe, expect, it } from 'vitest';
import {
  levenshtein,
  similarity,
  similarityVerdict,
} from './fuzzy.js';

describe('fuzzy similarity', () => {
  it('identical strings score 1', () => {
    expect(similarity('ABC TRADERS', 'ABC TRADERS')).toBe(1);
    expect(levenshtein('ABC', 'ABC')).toBe(0);
  });

  it('legal-suffix variants score high', () => {
    const score = similarity(
      'ABC TRADERS PVT LTD',
      'ABC TRADERS PRIVATE LIMITED',
    );
    expect(score).toBeGreaterThan(0.6);
    expect(similarityVerdict(score)).toBe('HIGH');
  });

  it('different parties score low', () => {
    const score = similarity('XYZ TRADERS', 'ABC TRADERS');
    expect(score).toBeLessThan(0.6);
    expect(similarityVerdict(score)).toBe('LOW');
  });

  it('empty handling is deterministic', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('ABC', '')).toBe(0);
    expect(similarity('', 'ABC')).toBe(0);
  });
});
