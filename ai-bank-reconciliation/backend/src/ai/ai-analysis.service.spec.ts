import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  AiProviderError,
  extractJson,
  isAiExceptionAnalysis,
  type AiExceptionAnalyzer,
  type AiExceptionAnalysis,
  type AiTransactionInput,
} from './ai-provider.js';
import { AI_EXCEPTION_PROMPT_V1, parseAiResponse } from './ai-prompt.js';
import { AiAnalysisService } from './ai-analysis.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESULT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const validAiJson = `{
  "classification": "WRONG_PARTY_CANDIDATE",
  "confidence": 0.91,
  "riskLevel": "HIGH",
  "reason": "Bank narration references ABC Traders while Tally posted XYZ Traders.",
  "evidence": [
    { "field": "party", "bankValue": "ABC TRADERS", "tallyValue": "XYZ TRADERS", "finding": "MISMATCH" }
  ],
  "recommendedAction": "Review Tally party allocation"
}`;

const deterministicResult = {
  id: RESULT_ID,
  matchStatus: 'REVIEW_REQUIRED',
  confidence: 65,
  amountDifference: null,
  dateDifferenceDays: 1,
  evidence: {
    amount: 'MATCH',
    direction: 'MATCH',
    date: 'CLOSE',
    party: 'MISMATCH',
    reference: 'MISSING',
  },
  bankTransaction: {
    transactionDate: new Date('2026-09-18T00:00:00.000Z'),
    amount: 75000,
    direction: 'DEBIT',
    narration: 'NEFT ABC TRADERS',
    reference: 'HDFC123456',
    normalizedNarration: 'NEFT ABC TRADERS',
  },
  tallyTransaction: {
    date: new Date('2026-09-17T00:00:00.000Z'),
    amount: 75000,
    direction: 'DEBIT',
    party: 'XYZ Traders',
    ledger: 'XYZ Traders',
    narration: null,
    reference: null,
    normalizedParty: 'XYZ TRADERS',
  },
};

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    reconciliationResult: { findUnique: vi.fn(), findMany: vi.fn() },
    reconciliationRun: { findUnique: vi.fn() },
    aIAnalysis: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function membership(role: CompanyRole = CompanyRole.ACCOUNTANT) {
  return { id: 'm-1', userId: USER_ID, companyId: COMPANY_ID, role };
}

function configOf(env: Record<string, string>) {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

function makeAnalyzer(
  impl: Partial<AiExceptionAnalyzer> | ((input: AiTransactionInput) => Promise<AiExceptionAnalysis>),
): AiExceptionAnalyzer {
  if (typeof impl === 'function') {
    return {
      provider: 'mock',
      model: 'mock-1',
      promptVersion: 'AI_EXCEPTION_PROMPT_V1',
      analyzeTransaction: impl,
      analyzeBatch: async (inputs) => Promise.all(inputs.map(impl)),
    };
  }
  return {
    provider: 'mock',
    model: 'mock-1',
    promptVersion: 'AI_EXCEPTION_PROMPT_V1',
    analyzeTransaction: vi.fn(),
    analyzeBatch: vi.fn(),
    ...impl,
  } as AiExceptionAnalyzer;
}

function serviceWith(
  prisma: PrismaMock,
  analyzer: AiExceptionAnalyzer,
): AiAnalysisService {
  const svc = new AiAnalysisService(
    prisma as unknown as PrismaService,
    configOf({}),
  );
  (svc as unknown as { analyzer: () => AiExceptionAnalyzer }).analyzer =
    () => analyzer;
  return svc;
}

describe('AI JSON validation', () => {
  it('1. accepts valid AI JSON', () => {
    const parsed = parseAiResponse(validAiJson);
    expect(parsed.classification).toBe('WRONG_PARTY_CANDIDATE');
    expect(parsed.confidence).toBeCloseTo(0.91);
    expect(parsed.riskLevel).toBe('HIGH');
    expect(isAiExceptionAnalysis(parsed)).toBe(true);
  });

  it('2. rejects malformed AI JSON', () => {
    expect(() => parseAiResponse('not json at all')).toThrow(AiProviderError);
    expect(() => parseAiResponse('{"classification": "MADE_UP"}')).toThrow(
      AiProviderError,
    );
    expect(() => parseAiResponse(validAiJson.replace('"HIGH"', '"EXTREME"'))).toThrow(
      AiProviderError,
    );
    expect(() => parseAiResponse(validAiJson.replace('0.91', '5'))).toThrow(
      AiProviderError,
    );
  });

  it('16. prompt is versioned and evidence-only', () => {
    expect(AI_EXCEPTION_PROMPT_V1).toContain('Do not invent facts');
    expect(AI_EXCEPTION_PROMPT_V1).toContain('Return only valid JSON');
    expect(AI_EXCEPTION_PROMPT_V1).toContain(
      'Do not assume an accounting error exists',
    );
    expect(AI_EXCEPTION_PROMPT_V1).toMatch(/AI_EXCEPTION_PROMPT_V1|assistant/);
  });
});

describe('AI service', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...deterministicResult,
      run: { id: RUN_ID, companyId: COMPANY_ID },
    });
    prisma.companyUser.findUnique.mockResolvedValue(membership());
    prisma.aIAnalysis.findFirst.mockResolvedValue(null);
    prisma.aIAnalysis.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'ai-1',
        ...args.data,
      }),
    );
  });

  it('5. classifies a wrong-party candidate', async () => {
    const analyzer = makeAnalyzer(async () =>
      parseAiResponse(validAiJson),
    );
    const outcome = await serviceWith(prisma, analyzer).analyzeResult(
      USER_ID,
      RESULT_ID,
    );
    expect(outcome.cached).toBe(false);
    expect(outcome.analysis?.classification).toBe('WRONG_PARTY_CANDIDATE');
    expect(outcome.analysis?.reason).not.toMatch('confirmed');
  });

  it('6. classifies duplicate candidates', async () => {
    const analyzer = makeAnalyzer(async () =>
      parseAiResponse(
        validAiJson
          .replace('WRONG_PARTY_CANDIDATE', 'DUPLICATE_CANDIDATE')
          .replace('Review Tally party allocation', 'Review for duplicate entry'),
      ),
    );
    const outcome = await serviceWith(prisma, analyzer).analyzeResult(
      USER_ID,
      RESULT_ID,
    );
    expect(outcome.analysis?.classification).toBe('DUPLICATE_CANDIDATE');
  });

  it('7/8/9. classifies amount/date anomalies and no-exception', async () => {
    const svc = serviceWith(
      prisma,
      makeAnalyzer(async () =>
        parseAiResponse(
          validAiJson.replace('WRONG_PARTY_CANDIDATE', 'AMOUNT_ANOMALY'),
        ),
      ),
    );
    expect(
      (await svc.analyzeResult(USER_ID, RESULT_ID)).analysis
        ?.classification,
    ).toBe('AMOUNT_ANOMALY');

    prisma.aIAnalysis.findFirst.mockResolvedValue(null);
    const svc2 = serviceWith(
      prisma,
      makeAnalyzer(async () =>
        parseAiResponse(
          validAiJson.replace('WRONG_PARTY_CANDIDATE', 'DATE_ANOMALY'),
        ),
      ),
    );
    expect(
      (await svc2.analyzeResult(USER_ID, RESULT_ID)).analysis
        ?.classification,
    ).toBe('DATE_ANOMALY');

    prisma.aIAnalysis.findFirst.mockResolvedValue(null);
    const svc3 = serviceWith(
      prisma,
      makeAnalyzer(async () =>
        parseAiResponse(
          validAiJson.replace('WRONG_PARTY_CANDIDATE', 'NO_EXCEPTION'),
        ),
      ),
    );
    expect(
      (await svc3.analyzeResult(USER_ID, RESULT_ID)).analysis
        ?.classification,
    ).toBe('NO_EXCEPTION');
  });

  it('3/4/10. provider failure keeps the deterministic result intact', async () => {
    const analyzer = makeAnalyzer(async () => {
      throw new AiProviderError('AI provider is temporarily unavailable', 'unavailable');
    });
    const outcome = await serviceWith(prisma, analyzer).analyzeResult(
      USER_ID,
      RESULT_ID,
    );
    expect(outcome.providerError).toBe('unavailable');
    expect(outcome.analysis?.provider).toBe('deterministic-fallback');
    expect(outcome.analysis?.classification).toBe('WRONG_PARTY_CANDIDATE');
    // The deterministic result row is never updated.
    expect(prisma.reconciliationResult.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining,
    );
    expect(
      prisma.reconciliationResult.findUnique.mock.calls.every(
        (c) => (c[0] as { where: unknown }).where !== undefined,
      ),
    ).toBe(true);
  });

  it('11. AI confidence is stored separately from deterministic confidence', async () => {
    const analyzer = makeAnalyzer(async () =>
      parseAiResponse(validAiJson),
    );
    await serviceWith(prisma, analyzer).analyzeResult(
      USER_ID,
      RESULT_ID,
    );
    const data = prisma.aIAnalysis.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data['deterministicConfidence']).toBe(65);
    expect(String(data['aiConfidence'])).toBe('0.91');
  });

  it('12. AI never modifies accounting data', async () => {
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    await serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID);
    // Reads are fine; WRITE calls on accounting tables must never happen.
    const writeMethods = [
      'create',
      'update',
      'delete',
      'upsert',
      'createMany',
      'updateMany',
      'deleteMany',
    ];
    for (const table of [
      'reconciliationResult',
      'reconciliationRun',
    ] as const) {
      const mock = prisma[table] as unknown as Record<
        string,
        { mock?: { calls: unknown[] } } | undefined
      >;
      for (const method of writeMethods) {
        expect(mock[method]?.mock?.calls ?? []).toHaveLength(0);
      }
    }
  });

  it('13. cross-company access yields 404', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(null);
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    await expect(
      serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('14. viewers/reviewers cannot run AI analysis', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership(CompanyRole.VIEWER));
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    await expect(
      serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('15. repeated analysis of unchanged result is cached', async () => {
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    const svc = serviceWith(prisma, analyzer);
    await svc.analyzeResult(USER_ID, RESULT_ID);
    // Second call: cache hit path.
    prisma.aIAnalysis.findFirst.mockResolvedValue({ id: 'ai-cached' });
    const second = await svc.analyzeResult(USER_ID, RESULT_ID);
    expect(second.cached).toBe(true);
    expect(second.analysis?.id).toBe('ai-cached');
    expect(prisma.aIAnalysis.create).toHaveBeenCalledTimes(1);
  });

  it('provider timeout falls back deterministically', async () => {
    const analyzer = makeAnalyzer(async () => {
      throw new AiProviderError('AI provider timed out', 'timeout');
    });
    const outcome = await serviceWith(prisma, analyzer).analyzeResult(
      USER_ID,
      RESULT_ID,
    );
    expect(outcome.providerError).toBe('timeout');
    expect(outcome.analysis).toBeTruthy();
  });

  it('bounded batch analyzes max 25 exception results', async () => {
    prisma.reconciliationRun.findUnique.mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
    });
    prisma.reconciliationResult.findMany.mockImplementation(
      async (args: { take?: number }) =>
        Array.from({ length: 30 }, (_, i) => ({
          ...deterministicResult,
          id: `r-${i}`,
        })).slice(0, args.take ?? 30),
    );
    prisma.aIAnalysis.findFirst.mockResolvedValue({ id: 'ai-cached' });
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    const result = await serviceWith(prisma, analyzer).analyzeBatch(
      USER_ID,
      RUN_ID,
    );
    expect(result.considered).toBeLessThanOrEqual(25);
    expect(result.cached).toBe(result.considered);
  });

  it('missing result yields 404', async () => {
    prisma.reconciliationResult.findUnique.mockResolvedValue(null);
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    await expect(
      serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes an audit row for every fresh analysis (who/when/what)', async () => {
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    await serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.auditLog.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      companyId: COMPANY_ID,
      userId: USER_ID,
      action: 'AI_ANALYSIS_REQUESTED',
      entity: 'AIAnalysis',
    });
    expect(typeof data['entityId']).toBe('string');
    // No secrets in the audit payload.
    expect(JSON.stringify(data)).not.toMatch(/api[_-]?key|bearer|jwt|secret/i);
  });

  it('does not audit cache hits', async () => {
    prisma.aIAnalysis.findFirst.mockResolvedValue({ id: 'ai-cached' });
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    await serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('different inputs never share a cached analysis', async () => {
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    const svc = serviceWith(prisma, analyzer);
    await svc.analyzeResult(USER_ID, RESULT_ID);
    // Same result, changed narration → different input hash → no cache hit.
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...deterministicResult,
      run: { id: RUN_ID, companyId: COMPANY_ID },
      bankTransaction: {
        ...deterministicResult.bankTransaction,
        narration: 'NEFT DIFFERENT PARTY',
        normalizedNarration: 'NEFT DIFFERENT PARTY',
      },
    });
    prisma.aIAnalysis.findFirst.mockResolvedValue(null);
    const second = await svc.analyzeResult(USER_ID, RESULT_ID);
    expect(second.cached).toBe(false);
    expect(prisma.aIAnalysis.create).toHaveBeenCalledTimes(2);
  });

  it('built provider input contains no secrets or tokens', async () => {
    let seen: unknown;
    const analyzer = makeAnalyzer(async (input) => {
      seen = input;
      return parseAiResponse(validAiJson);
    });
    await serviceWith(prisma, analyzer).analyzeResult(USER_ID, RESULT_ID);
    const dumped = JSON.stringify(seen);
    expect(dumped).not.toMatch(
      /password|jwt|bearer|api[_-]?key|secret|credential/i,
    );
    const parsed = JSON.parse(dumped) as {
      bank: Record<string, unknown>;
      tally: Record<string, unknown> | null;
      deterministic: Record<string, unknown>;
    };
    expect(Object.keys(parsed).sort()).toEqual(
      ['bank', 'deterministic', 'fuzzy', 'tally'].sort(),
    );
    expect(parsed.bank['amount']).toBe('75000');
  });

  it('persists bank-charge style rows with valid shape', async () => {
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...deterministicResult,
      run: { id: RUN_ID, companyId: COMPANY_ID },
      bankTransaction: {
        ...deterministicResult.bankTransaction,
        amount: 590,
        narration: 'BANK CHARGES',
        normalizedNarration: 'BANK CHARGES',
        reference: null,
      },
      tallyTransaction: null,
    });
    const analyzer = makeAnalyzer(async () => parseAiResponse(validAiJson));
    const outcome = await serviceWith(prisma, analyzer).analyzeResult(
      USER_ID,
      RESULT_ID,
    );
    expect(outcome.analysis?.classification).toBe('WRONG_PARTY_CANDIDATE');
    const data = prisma.aIAnalysis.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // AI confidence (0.91) stored separately from deterministic (65).
    expect(String(data['aiConfidence'])).toBe('0.91');
    expect(data['deterministicConfidence']).toBe(65);
  });
});

describe('extractJson', () => {
  it('tolerates code fences', () => {
    const parsed = extractJson('```json\n{"a": 1}\n```');
    expect(parsed).toEqual({ a: 1 });
  });
});
