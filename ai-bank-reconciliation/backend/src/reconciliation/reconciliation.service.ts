import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyRole,
  ImportStatus,
  LinkSide,
} from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateRunDto } from './dto/create-run.dto.js';
import type { ResultsQueryDto } from './dto/results-query.dto.js';
import {
  InlineReconciliationQueue,
  runReconciliation,
  type EngineBankRow,
  type EngineTallyRow,
} from './engine.js';
import { DEFAULT_MATCH_CONFIG } from './match-config.js';
import {
  DEFAULT_SPLIT_CONFIG,
  SplitMatchStrategy,
} from './splits.js';

const RUN_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];
const DAY_MS = 86400000;

function parseDay(raw: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Reconciliation runs. Read-only analysis: loads Bank/Tally rows, runs the
 * deterministic engine, persists runs + results. Never writes to Bank or
 * Tally tables. Execution goes through ReconciliationQueue (inline today,
 * BullMQ worker later) so datasets can move off the request path.
 */
@Injectable()
export class ReconciliationService {
  private readonly queue = new InlineReconciliationQueue((runId) =>
    this.executeRun(runId),
  );

  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Reconciliation run not found');
    }
    return membership;
  }

  async createRun(userId: string, dto: CreateRunDto) {
    const from = parseDay(dto.fromDate);
    const to = parseDay(dto.toDate);
    if (!from || !to || from > to) {
      throw new BadRequestException('Invalid date range');
    }
    const tolerance = dto.dateToleranceDays ?? DEFAULT_MATCH_CONFIG.dateToleranceDays;

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }
    const membership = await this.requireMembership(userId, account.companyId);
    if (!RUN_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can run reconciliations',
      );
    }

    const run = await this.prisma.reconciliationRun.create({
      data: {
        companyId: account.companyId,
        bankAccountId: account.id,
        fromDate: from,
        toDate: to,
        dateToleranceDays: tolerance,
        status: ImportStatus.PENDING,
        createdBy: userId,
        config: {
          dateToleranceDays: tolerance,
          bankLedger: dto.bankLedger ?? null,
          weightsVersion: 1,
        },
      },
    });

    try {
      await this.queue.enqueue({ runId: run.id });
    } catch {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: ImportStatus.FAILED, completedAt: new Date() },
      });
      return { runId: run.id, status: ImportStatus.FAILED };
    }
    const finished = await this.prisma.reconciliationRun.findUnique({
      where: { id: run.id },
    });
    return { runId: run.id, status: finished?.status ?? ImportStatus.FAILED };
  }

  /** Load → match → persist. Pure engine call in the middle (worker-ready). */
  async executeRun(runId: string): Promise<void> {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException('Reconciliation run not found');
    await this.prisma.reconciliationRun.update({
      where: { id: runId },
      data: { status: ImportStatus.PROCESSING, startedAt: new Date() },
    });

    try {
      const endExclusive = new Date(run.toDate.getTime() + DAY_MS);
      const config = (run.config ?? {}) as { bankLedger?: string | null };
      const [bankRows, tallyRows] = await Promise.all([
        this.prisma.bankTransaction.findMany({
          where: {
            companyId: run.companyId,
            bankAccountId: run.bankAccountId,
            transactionDate: { gte: run.fromDate, lt: endExclusive },
          },
          orderBy: { transactionDate: 'asc' },
        }),
        this.prisma.tallyTransaction.findMany({
          where: {
            companyId: run.companyId,
            date: { gte: run.fromDate, lt: endExclusive },
            ...(config.bankLedger ? { bankLedger: config.bankLedger } : {}),
          },
          orderBy: { date: 'asc' },
        }),
      ]);

      const engineBank: EngineBankRow[] = bankRows.map((b) => ({
        id: b.id,
        date: b.transactionDate,
        amount: b.amount.toString(),
        direction: b.direction,
        reference: b.reference ?? undefined,
        normalizedReference: b.normalizedReference ?? undefined,
        chequeNumber: b.chequeNumber ?? undefined,
        normalizedNarration: b.normalizedNarration ?? undefined,
        narration: b.narration ?? undefined,
      }));
      const engineTally: EngineTallyRow[] = tallyRows.map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount.toString(),
        direction: t.direction,
        reference: t.reference ?? undefined,
        normalizedParty: t.normalizedParty ?? undefined,
        ledger: t.ledger ?? undefined,
        voucherNo: t.voucherNo ?? undefined,
      }));

      const outcome = runReconciliation(
        engineBank,
        engineTally,
        new SplitMatchStrategy({ ...DEFAULT_SPLIT_CONFIG }),
        {
          ...DEFAULT_MATCH_CONFIG,
          dateToleranceDays: run.dateToleranceDays,
        },
      );

      const withIds = outcome.matches.map((m) => ({
        ...m,
        resultId: randomUUID(),
        matchType: m.matchType ?? 'ONE_TO_ONE',
      }));

      if (withIds.length > 0) {
        const chunks: typeof withIds[] = [];
        for (let i = 0; i < withIds.length; i += 500) {
          chunks.push(withIds.slice(i, i + 500));
        }
        for (const chunk of chunks) {
          await this.prisma.reconciliationResult.createMany({
            data: chunk.map((m) => ({
              id: m.resultId,
              reconciliationRunId: runId,
              bankTransactionId: m.bankId,
              tallyTransactionId: m.tallyId,
              matchStatus: m.status,
              matchType: m.matchType as 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'DUPLICATE_CANDIDATE',
              bankTotal: m.bankTotal,
              tallyTotal: m.tallyTotal,
              confidence: m.confidence,
              amountDifference: m.amountDifference,
              dateDifferenceDays: m.dateDifferenceDays,
              matchReason: m.reason,
              evidence: {
                ...m.evidence,
                matchType: m.matchType ?? 'ONE_TO_ONE',
                bankTransactionIds: m.bankIds ?? (m.bankId ? [m.bankId] : []),
                tallyTransactionIds:
                  m.tallyIds ?? (m.tallyId ? [m.tallyId] : []),
                bankTotal: m.bankTotal ?? null,
                tallyTotal: m.tallyTotal ?? null,
              },
            })),
          });
          const links = chunk.flatMap((m) => [
            ...(m.bankIds ?? (m.bankId ? [m.bankId] : [])).map((id) => ({
              id: randomUUID(),
              reconciliationResultId: m.resultId,
              side: LinkSide.BANK,
              bankTransactionId: id,
              tallyTransactionId: null,
            })),
            ...(m.tallyIds ?? (m.tallyId ? [m.tallyId] : [])).map((id) => ({
              id: randomUUID(),
              reconciliationResultId: m.resultId,
              side: LinkSide.TALLY,
              bankTransactionId: null,
              tallyTransactionId: id,
            })),
          ]);
          if (links.length > 0) {
            const linkChunks: typeof links[] = [];
            for (let i = 0; i < links.length; i += 500) {
              linkChunks.push(links.slice(i, i + 500));
            }
            for (const linkChunk of linkChunks) {
              await this.prisma.reconciliationResultLink.createMany({
                data: linkChunk,
              });
            }
          }
        }
      }

      const count = (s: string) =>
        outcome.matches.filter((m) => m.status === s).length;
      await this.prisma.reconciliationRun.update({
        where: { id: runId },
        data: {
          status: ImportStatus.COMPLETED,
          completedAt: new Date(),
          totalBankTransactions: bankRows.length,
          totalTallyTransactions: tallyRows.length,
          matchedCount: count('MATCHED'),
          possibleMatchCount: count('POSSIBLE_MATCH'),
          unmatchedCount: count('UNMATCHED'),
          exceptionCount:
            count('AMOUNT_MISMATCH') +
            count('DATE_MISMATCH') +
            count('REVIEW_REQUIRED') +
            count('MISSING_IN_TALLY') +
            count('MISSING_IN_BANK'),
        },
      });
    } catch {
      await this.prisma.reconciliationRun.update({
        where: { id: runId },
        data: { status: ImportStatus.FAILED, completedAt: new Date() },
      });
      throw new Error('Reconciliation run failed');
    }
  }

  async listRuns(userId: string, companyId: string) {
    await this.requireMembership(userId, companyId);
    return this.prisma.reconciliationRun.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRun(userId: string, runId: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
      include: { bankAccount: true },
    });
    if (!run) {
      throw new NotFoundException('Reconciliation run not found');
    }
    await this.requireMembership(userId, run.companyId);

    // Dashboard counts from database state (Step 10) — review + AI.
    const [reviewGroups, aiByClass, aiByRisk] = await Promise.all([
      this.prisma.reconciliationResult.groupBy({
        by: ['reviewStatus'],
        where: { reconciliationRunId: runId },
        _count: { _all: true },
      }),
      this.prisma.aIAnalysis.groupBy({
        by: ['classification'],
        where: {
          result: { reconciliationRunId: runId },
        },
        _count: { _all: true },
      }),
      this.prisma.aIAnalysis.groupBy({
        by: ['riskLevel'],
        where: {
          result: { reconciliationRunId: runId },
        },
        _count: { _all: true },
      }),
    ]);
    const reviewOf = (g: unknown) =>
      (g as { reviewStatus?: string }).reviewStatus ?? '';
    const reviewSummary = {
      pendingReview:
        reviewGroups.find((g) => reviewOf(g) === 'PENDING_REVIEW')?._count
          ._all ?? 0,
      inReview:
        reviewGroups.find((g) => reviewOf(g) === 'IN_REVIEW')?._count._all ??
        0,
      confirmed: reviewGroups
        .filter((g) =>
          [
            'CONFIRMED_MATCH',
            'WRONG_PARTY',
            'DUPLICATE_CONFIRMED',
            'AMOUNT_MISMATCH_CONFIRMED',
            'DATE_MISMATCH_CONFIRMED',
            'MISSING_IN_TALLY_CONFIRMED',
            'MISSING_IN_BANK_CONFIRMED',
          ].includes(reviewOf(g)),
        )
        .reduce((acc, g) => acc + g._count._all, 0),
      rejected:
        reviewGroups.find((g) => reviewOf(g) === 'REJECTED')?._count._all ?? 0,
      ignored:
        reviewGroups.find((g) => reviewOf(g) === 'IGNORED')?._count._all ?? 0,
      wrongParty:
        reviewGroups.find((g) => reviewOf(g) === 'WRONG_PARTY')?._count._all ??
        0,
      duplicate:
        reviewGroups.find((g) => reviewOf(g) === 'DUPLICATE_CONFIRMED')?._count
          ._all ?? 0,
      amountMismatch:
        reviewGroups.find((g) => reviewOf(g) === 'AMOUNT_MISMATCH_CONFIRMED')
          ?._count._all ?? 0,
      dateMismatch:
        reviewGroups.find((g) => reviewOf(g) === 'DATE_MISMATCH_CONFIRMED')
          ?._count._all ?? 0,
      missingInTally:
        reviewGroups.find((g) => reviewOf(g) === 'MISSING_IN_TALLY_CONFIRMED')
          ?._count._all ?? 0,
      missingInBank:
        reviewGroups.find((g) => reviewOf(g) === 'MISSING_IN_BANK_CONFIRMED')
          ?._count._all ?? 0,
    };
    const aiSummary = {
      byClassification: Object.fromEntries(
        aiByClass.map((g) => [
          (g as unknown as { classification: string }).classification,
          g._count._all,
        ]),
      ),
      byRisk: Object.fromEntries(
        aiByRisk.map((g) => [
          (g as unknown as { riskLevel: string }).riskLevel,
          g._count._all,
        ]),
      ),
    };

    return {
      ...run,
      reviewSummary,
      aiSummary,
    };
  }

  async listResults(userId: string, runId: string, q: ResultsQueryDto) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Reconciliation run not found');
    }
    await this.requireMembership(userId, run.companyId);

    const from = q.fromDate ? parseDay(q.fromDate) : undefined;
    const toExclusive = q.toDate
      ? new Date((parseDay(q.toDate)?.getTime() ?? 0) + DAY_MS)
      : undefined;

    const take = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const skip = Math.max(q.offset ?? 0, 0);
    const where = {
      reconciliationRunId: runId,
      ...(q.status ? { matchStatus: q.status } : {}),
      ...(q.matchType ? { matchType: q.matchType } : {}),
      ...(q.reviewStatus
        ? {
            reviewStatus:
              q.reviewStatus.toUpperCase() as never,
          }
        : {}),
      ...(q.bankAccountId ? { bankTransaction: { bankAccountId: q.bankAccountId } } : {}),
      ...(q.risk || q.aiClassification
        ? {
            aiAnalyses: {
              some: {
                ...(q.risk
                  ? { riskLevel: q.risk.toUpperCase() as never }
                  : {}),
                ...(q.aiClassification
                  ? { classification: q.aiClassification.toUpperCase() as never }
                  : {}),
              },
            },
          }
        : {}),
      ...((q.party || q.reference || q.minAmount || q.maxAmount || from || toExclusive)
        ? {
            OR: [
              {
                bankTransaction: {
                  ...(q.party
                    ? {
                        OR: [
                          { narration: { contains: q.party, mode: 'insensitive' as const } },
                          { description: { contains: q.party, mode: 'insensitive' as const } },
                        ],
                      }
                    : {}),
                  ...(q.reference
                    ? { reference: { contains: q.reference, mode: 'insensitive' as const } }
                    : {}),
                  ...((q.minAmount || q.maxAmount)
                    ? {
                        amount: {
                          ...(q.minAmount ? { gte: q.minAmount } : {}),
                          ...(q.maxAmount ? { lte: q.maxAmount } : {}),
                        },
                      }
                    : {}),
                  ...(from || toExclusive
                    ? {
                        transactionDate: {
                          ...(from ? { gte: from } : {}),
                          ...(toExclusive ? { lt: toExclusive } : {}),
                        },
                      }
                    : {}),
                },
              },
              {
                tallyTransaction: {
                  ...(q.party
                    ? {
                        OR: [
                          { party: { contains: q.party, mode: 'insensitive' as const } },
                          { ledger: { contains: q.party, mode: 'insensitive' as const } },
                        ],
                      }
                    : {}),
                  ...(q.reference
                    ? { reference: { contains: q.reference, mode: 'insensitive' as const } }
                    : {}),
                  ...((q.minAmount || q.maxAmount)
                    ? {
                        amount: {
                          ...(q.minAmount ? { gte: q.minAmount } : {}),
                          ...(q.maxAmount ? { lte: q.maxAmount } : {}),
                        },
                      }
                    : {}),
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.reconciliationResult.count({ where }),
      this.prisma.reconciliationResult.findMany({
        where,
        include: {
          bankTransaction: true,
          tallyTransaction: true,
          links: {
            include: { bankTransaction: true, tallyTransaction: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        take,
        skip,
      }),
    ]);
    return { total, rows };
  }
}
