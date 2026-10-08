import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AiProviderError,
  AiTransactionInput,
} from './ai-provider.js';
import {
  HttpAiExceptionAnalyzer,
  MAX_PROVIDER_ATTEMPTS,
} from './http-ai-analyzer.js';
import { AI_EXCEPTION_PROMPT_V2 } from './ai-prompt.js';

const input: AiTransactionInput = {
  bank: {
    date: '2026-09-18',
    amount: '75000',
    direction: 'DEBIT',
    narration: 'NEFT ABC TRADERS',
    reference: 'HDFC123456',
    normalizedNarration: 'NEFT ABC TRADERS',
  },
  tally: {
    date: '2026-09-17',
    amount: '75000',
    direction: 'DEBIT',
    party: 'XYZ Traders',
    normalizedParty: 'XYZ TRADERS',
  },
  deterministic: {
    matchStatus: 'REVIEW_REQUIRED',
    matchType: 'ONE_TO_ONE',
    confidence: 65,
    amountDifference: null,
    dateDifferenceDays: 1,
    evidence: { amount: 'MATCH', party: 'MISMATCH' },
  },
  fuzzy: { party: 0.3 },
};

const okBody = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          classification: 'WRONG_PARTY_CANDIDATE',
          confidence: 0.91,
          riskLevel: 'HIGH',
          reason: 'Party mismatch with matching amount.',
          evidence: [
            {
              field: 'party',
              bankValue: 'ABC TRADERS',
              tallyValue: 'XYZ TRADERS',
              finding: 'MISMATCH',
            },
          ],
          recommendedAction: 'Review Tally party allocation',
        }),
      },
    },
  ],
};

function configOf(env: Record<string, string>) {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

function analyzer() {
  return new HttpAiExceptionAnalyzer(
    configOf({ AI_API_KEY: 'test-key-abc123', AI_RETRY_BASE_MS: '1' }),
  );
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('HttpAiExceptionAnalyzer retries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries a 500 then succeeds (bounded, no duplicates)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzer().analyzeTransaction(input);
    expect(result.classification).toBe('WRONG_PARTY_CANDIDATE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 429s then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzer().analyzeTransaction(input);
    expect(result.classification).toBe('WRONG_PARTY_CANDIDATE');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after bounded attempts on persistent 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, {}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzer().analyzeTransaction(input)).rejects.toMatchObject({
      name: 'AiProviderError',
      kind: 'rate_limited',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROVIDER_ATTEMPTS);
    expect(MAX_PROVIDER_ATTEMPTS).toBeLessThanOrEqual(3);
  });

  it('gives up after bounded attempts on persistent 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzer().analyzeTransaction(input)).rejects.toMatchObject({
      kind: 'unavailable',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROVIDER_ATTEMPTS);
  });

  it('does NOT retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzer().analyzeTransaction(input)).rejects.toMatchObject({
      kind: 'auth',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry malformed responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'not json' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzer().analyzeTransaction(input)).rejects.toMatchObject({
      kind: 'malformed',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network failures with backoff, then reports unavailable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzer().analyzeTransaction(input)).rejects.toMatchObject({
      kind: 'unavailable',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROVIDER_ATTEMPTS);
  });

  it('retries timeouts, then reports timeout', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    const fetchMock = vi.fn().mockRejectedValue(err);
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzer().analyzeTransaction(input)).rejects.toMatchObject({
      kind: 'timeout',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PROVIDER_ATTEMPTS);
  });

  it('sends the key in the header only, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, okBody));
    vi.stubGlobal('fetch', fetchMock);
    await analyzer().analyzeTransaction(input);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('test-key-abc123');
    expect(
      (init.headers as Record<string, string>)['Authorization'],
    ).toBe('Bearer test-key-abc123');
  });

  it('refuses to call without a configured key', async () => {
    const noKey = new HttpAiExceptionAnalyzer(configOf({}));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(noKey.analyzeTransaction(input)).rejects.toMatchObject({
      kind: 'unavailable',
    } satisfies Partial<AiProviderError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AI_EXCEPTION_PROMPT_V2 guardrails', () => {
  it('contains all required safety instructions', () => {
    for (const phrase of [
      'Do not invent facts',
      'Do not invent transactions, references, or accounting entries',
      'Do not assume party identity without evidence',
      'Do not provide unsupported certainty',
      'distinguish fact from inference',
      'Recommend human review for ambiguous cases',
      'cannot modify accounting data',
      'Return only valid JSON',
      'Do not assume an accounting error exists',
      'candidates require accountant review',
    ]) {
      expect(AI_EXCEPTION_PROMPT_V2).toContain(phrase);
    }
  });
});
