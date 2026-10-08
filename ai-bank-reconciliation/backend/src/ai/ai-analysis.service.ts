import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { Prisma as PrismaJson } from '../generated/prisma/client.js';
import { CompanyRole } from '../generated/prisma/client.js';
import { similarity } from '../common/fuzzy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AiExceptionAnalyzer,
  AiTransactionInput,
} from './ai-provider.js';
import { AiProviderError } from './ai-provider.js';
import { HttpAiExceptionAnalyzer } from './http-ai-analyzer.js';
import { heuristicWrongParty } from './wrong-party-heuristic.js';

const RUN_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];
const MAX_BATCH = 25;
const PROMPT_VERSION = 'AI_EXCEPTION_PROMPT_V2';

/**
 * AI exception analysis (advisory layer). The deterministic reconciliation
 * result is always the source of truth: AI failures never fail a run and
 * never alter matchStatus. Analyses are cached by
 * result + promptVersion + model + input hash so unchanged results are
 * never re-analyzed.
 */
@Injectable()
export class AiAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private analyzer(): AiExceptionAnalyzer {
    // Fresh instance per call so env changes/tests don't require restarts.
    return new HttpAiExceptionAnalyzer(this.configService);
  }

  private async requireResultAccess(userId: string, resultId: string) {
    const result = await this.prisma.reconciliationResult.findUnique({
      where: { id: resultId },
      include: {
        run: true,
        bankTransaction: true,
        tallyTransaction: true,
      },
    });
    if (!result) {
      throw new NotFoundException('Reconciliation result not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: result.run.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Reconciliation result not found');
    }
    return { result, membership };
  }

  private buildInput(result: {
    matchStatus: string;
    confidence: number | null;
    amountDifference: Decimal | null;
    dateDifferenceDays: number | null;
    evidence: unknown;
    bankTransaction: {
      transactionDate: Date;
      amount: Decimal;
      direction: string;
      narration?: string | null;
      reference?: string | null;
      normalizedNarration?: string | null;
    } | null;
    tallyTransaction: {
      date: Date;
      amount: Decimal;
      direction: string;
      party?: string | null;
      ledger?: string | null;
      narration?: string | null;
      reference?: string | null;
      normalizedParty?: string | null;
    } | null;
  }): AiTransactionInput {
    const b = result.bankTransaction;
    const t = result.tallyTransaction;
    const evidence = (result.evidence ?? {}) as Record<string, string>;
    return {
      bank: {
        date: b ? b.transactionDate.toISOString().slice(0, 10) : '',
        amount: b ? b.amount.toString() : '',
        direction: b?.direction ?? '',
        narration: b?.narration ?? undefined,
        reference: b?.reference ?? undefined,
        normalizedNarration: b?.normalizedNarration ?? undefined,
      },
      tally: t
        ? {
            date: t.date.toISOString().slice(0, 10),
            amount: t.amount.toString(),
            direction: t.direction,
            party: t.party ?? undefined,
            ledger: t.ledger ?? undefined,
            narration: t.narration ?? undefined,
            reference: t.reference ?? undefined,
            normalizedParty: t.normalizedParty ?? undefined,
          }
        : null,
      deterministic: {
        matchStatus: result.matchStatus,
        matchType: evidence['matchType'] ?? 'ONE_TO_ONE',
        confidence: result.confidence,
        amountDifference: result.amountDifference?.toString() ?? null,
        dateDifferenceDays: result.dateDifferenceDays,
        evidence,
      },
      fuzzy: {
        narration:
          b?.normalizedNarration && t?.normalizedParty
            ? similarity(b.normalizedNarration, t.normalizedParty)
            : undefined,
        party:
          b?.normalizedNarration && t?.normalizedParty
            ? similarity(b.normalizedNarration, t.normalizedParty)
            : undefined,
        reference:
          b?.reference && t?.reference
            ? similarity(b.reference, t.reference)
            : undefined,
      },
    };
  }

  private inputHash(input: AiTransactionInput): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private async findCached(
    resultId: string,
    model: string,
    hash: string,
  ) {
    return this.prisma.aIAnalysis.findFirst({
      where: {
        reconciliationResultId: resultId,
        promptVersion: PROMPT_VERSION,
        model,
        inputHash: hash,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private asJson(value: unknown): PrismaJson.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as PrismaJson.InputJsonValue;
  }

  /**
   * Audit trail for every fresh (non-cached) analysis: who, when, which
   * result, provider, model, status. Never stores the API key.
   */
  private async auditAnalysis(
    userId: string,
    companyId: string,
    analysisId: string,
    classification: string,
    provider: string,
    model: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'AI_ANALYSIS_REQUESTED',
        entity: 'AIAnalysis',
        entityId: analysisId,
        newValue: this.asJson({ classification, provider, model }),
      },
    });
  }

  /**
   * Analyze ONE result on explicit user action. Falls back to the
   * deterministic heuristic when the provider is unavailable; never throws
   * for provider failures (the run/result stay intact).
   */
  async analyzeResult(userId: string, resultId: string) {
    const { result, membership } = await this.requireResultAccess(
      userId,
      resultId,
    );
    if (!RUN_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can run AI analysis',
      );
    }

    const input = this.buildInput(result);
    const hash = this.inputHash(input);
    const analyzer = this.analyzer();

    // Cache: reuse when result input + prompt + model are unchanged.
    const cached = await this.findCached(resultId, analyzer.model, hash);
    if (cached) {
      return { cached: true, analysis: cached };
    }

    let saved;
    try {
      const analysis = await analyzer.analyzeTransaction(input);
      saved = await this.prisma.aIAnalysis.create({
        data: {
          reconciliationResultId: resultId,
          provider: analyzer.provider,
          model: analyzer.model,
          promptVersion: PROMPT_VERSION,
          classification: analysis.classification,
          aiConfidence: new Decimal(analysis.confidence.toFixed(4)),
          riskLevel: analysis.riskLevel,
          reason: analysis.reason.slice(0, 2000),
          evidence: this.asJson({
            items: analysis.evidence,
            fuzzy: input.fuzzy,
          }),
          recommendedAction: analysis.recommendedAction?.slice(0, 500),
          inputHash: hash,
          deterministicConfidence: result.confidence,
        },
      });
      await this.auditAnalysis(
        userId,
        result.run.companyId,
        saved.id,
        analysis.classification,
        analyzer.provider,
        analyzer.model,
      );
      return { cached: false, analysis: saved };
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      // Deterministic fallback — advisory only, never fails the caller.
      // Reuse a prior fallback analysis of the same unchanged input
      // (same cache key semantics, fallback model).
      const fbCached = await this.findCached(resultId, 'heuristic-v1', hash);
      if (fbCached) {
        return { cached: true, analysis: fbCached };
      }
      const heuristic = heuristicWrongParty(input);
      saved = await this.prisma.aIAnalysis.create({
        data: {
          reconciliationResultId: resultId,
          provider: 'deterministic-fallback',
          model: 'heuristic-v1',
          promptVersion: PROMPT_VERSION,
          classification: heuristic.likely
            ? 'WRONG_PARTY_CANDIDATE'
            : 'NO_EXCEPTION',
          aiConfidence: new Decimal(heuristic.likely ? '0.7000' : '0.9000'),
          riskLevel: heuristic.likely ? 'MEDIUM' : 'LOW',
          reason:
            heuristic.likely
              ? heuristic.reason
              : `AI provider unavailable (${error.kind}); deterministic evidence shows no additional exception.`,
          evidence: this.asJson({
            items: [],
            fuzzy: input.fuzzy,
            providerError: error.kind,
          }),
          recommendedAction: heuristic.likely
            ? 'Review Tally party allocation'
            : undefined,
          inputHash: hash,
          deterministicConfidence: result.confidence,
        },
      });
      await this.auditAnalysis(
        userId,
        result.run.companyId,
        saved.id,
        heuristic.likely ? 'WRONG_PARTY_CANDIDATE' : 'NO_EXCEPTION',
        'deterministic-fallback',
        'heuristic-v1',
      );
      return { cached: false, analysis: saved, providerError: error.kind };
    }
  }

  async getLatest(userId: string, resultId: string) {
    await this.requireResultAccess(userId, resultId);
    const analysis = await this.prisma.aIAnalysis.findFirst({
      where: { reconciliationResultId: resultId },
      orderBy: { createdAt: 'desc' },
    });
    return analysis;
  }

  /** Bounded batch analysis (explicit user action, max 25 per call). */
  async analyzeBatch(userId: string, runId: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Reconciliation run not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId: run.companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Reconciliation run not found');
    }
    if (!RUN_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can run AI analysis',
      );
    }
    const results = await this.prisma.reconciliationResult.findMany({
      where: {
        reconciliationRunId: runId,
        matchStatus: {
          in: [
            'REVIEW_REQUIRED',
            'POSSIBLE_MATCH',
            'AMOUNT_MISMATCH',
            'DATE_MISMATCH',
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_BATCH,
    });
    let analyzed = 0;
    let cached = 0;
    let fallback = 0;
    const errors: string[] = [];
    for (const result of results) {
      const outcome = await this.analyzeResult(userId, result.id);
      if (outcome.cached) cached += 1;
      else analyzed += 1;
      if (outcome.providerError) fallback += 1;
      void errors;
    }
    return {
      runId,
      considered: results.length,
      analyzed,
      cached,
      fallback,
      maxBatch: MAX_BATCH,
    };
  }
}
