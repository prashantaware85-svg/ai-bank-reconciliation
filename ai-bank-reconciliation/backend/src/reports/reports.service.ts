import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86400000;
const MAX_EXPORT_ROWS = 20000;
const EXCEPTION_STATUSES = [
  'AMOUNT_MISMATCH',
  'DATE_MISMATCH',
  'REVIEW_REQUIRED',
  'MISSING_IN_TALLY',
  'MISSING_IN_BANK',
];
const CONFIRMED_STATUSES = [
  'CONFIRMED_MATCH',
  'WRONG_PARTY',
  'DUPLICATE_CONFIRMED',
  'AMOUNT_MISMATCH_CONFIRMED',
  'DATE_MISMATCH_CONFIRMED',
  'MISSING_IN_TALLY_CONFIRMED',
  'MISSING_IN_BANK_CONFIRMED',
];

// class-validator decorators are required on every property — the global
// whitelist strips undecorated properties and forbidNonWhitelisted
// rejects the request (Step 10 lesson). A single merged DTO per route:
// two @Query() DTOs on one handler would each validate the whole query.
export class ReportFilterDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  toDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reviewStatus?: string;
}

export class DashboardQueryDto extends ReportFilterDto {
  @IsUUID('4', { message: 'companyId must be a valid UUID' })
  companyId!: string;

  @IsOptional()
  @IsUUID('4', { message: 'bankAccountId must be a valid UUID' })
  bankAccountId?: string;
}

export type ReportFilter = ReportFilterDto & { bankAccountId?: string };

function parseDay(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(`Invalid date "${raw}" (use YYYY-MM-DD)`);
  }
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid date "${raw}"`);
  }
  return d;
}

/**
 * Reporting + dashboard aggregation (Step 11). READ-ONLY: server-side
 * COUNT/SUM/GROUP BY only — never modifies accounting or review data.
 * Company is always resolved through membership; bankAccountId is
 * verified to belong to the company.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Company not found');
    }
    return membership;
  }

  /** Validated scope: membership + optional account ownership + range. */
  async resolveScope(
    userId: string,
    companyId: string,
    filter: ReportFilter,
  ): Promise<{
    companyId: string;
    from: Date;
    toExclusive: Date;
    runWhere: Record<string, unknown>;
    txnWhere: Record<string, unknown>;
    resultWhere: Record<string, unknown>;
  }> {
    const membership = await this.requireMembership(userId, companyId);
    void membership;
    if (filter.bankAccountId) {
      const account = await this.prisma.bankAccount.findUnique({
        where: { id: filter.bankAccountId },
      });
      if (!account || account.companyId !== companyId) {
        throw new NotFoundException('Bank account not found');
      }
    }
    const from = parseDay(filter.fromDate) ?? new Date('2000-01-01T00:00:00.000Z');
    const toDate = parseDay(filter.toDate);
    if (from && toDate && from > toDate) {
      throw new BadRequestException('fromDate must not be after toDate');
    }
    const toExclusive = toDate
      ? new Date(toDate.getTime() + DAY_MS)
      : new Date('2100-01-01T00:00:00.000Z');

    const runWhere: Record<string, unknown> = {
      companyId,
      ...(filter.bankAccountId ? { bankAccountId: filter.bankAccountId } : {}),
    };
    const txnWhere: Record<string, unknown> = {
      companyId,
      transactionDate: { gte: from, lt: toExclusive },
      ...(filter.bankAccountId ? { bankAccountId: filter.bankAccountId } : {}),
    };
    const resultWhere: Record<string, unknown> = {
      run: runWhere,
      ...(filter.status ? { matchStatus: filter.status as never } : {}),
      ...(filter.reviewStatus
        ? { reviewStatus: filter.reviewStatus as never }
        : {}),
    };
    return { companyId, from, toExclusive, runWhere, txnWhere, resultWhere };
  }

  /** Full dashboard aggregate — all numbers from the database. */
  async dashboard(userId: string, companyId: string, filter: ReportFilter) {
    const scope = await this.resolveScope(userId, companyId, filter);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');

    const [
      totalBank,
      totalTally,
      bankSum,
      tallySum,
      byStatus,
      byReview,
      accounts,
    ] = await Promise.all([
      this.prisma.bankTransaction.count({ where: scope.txnWhere }),
      this.prisma.tallyTransaction.count({
        where: {
          companyId: scope.companyId,
          date: scope.txnWhere['transactionDate'] as object,
        },
      }),
      this.prisma.bankTransaction.aggregate({
        where: scope.txnWhere,
        _sum: { amount: true },
      }),
      this.prisma.tallyTransaction.aggregate({
        where: {
          companyId: scope.companyId,
          date: scope.txnWhere['transactionDate'] as object,
        },
        _sum: { amount: true },
      }),
      this.prisma.reconciliationResult.groupBy({
        by: ['matchStatus'],
        where: scope.resultWhere,
        _count: { _all: true },
      }),
      this.prisma.reconciliationResult.groupBy({
        by: ['reviewStatus'],
        where: scope.resultWhere,
        _count: { _all: true },
      }),
      this.bankAccountSummary(userId, companyId, filter),
    ]);

    const statusOf = (g: unknown) =>
      (g as { matchStatus?: string }).matchStatus ?? '';
    const reviewOf = (g: unknown) =>
      (g as { reviewStatus?: string }).reviewStatus ?? '';
    const countBy = (groups: unknown[], key: 'statusOf' | 'reviewOf', value: string): number => {
      void key;
      return groups
        .filter((g) =>
          'matchStatus' in (g as object)
            ? statusOf(g) === value
            : reviewOf(g) === value,
        )
        .reduce((acc: number, g) => acc + (g as { _count: { _all: number } })._count._all, 0);
    };

    const matchedBank = await this.prisma.bankTransaction.aggregate({
      where: {
        ...scope.txnWhere,
        reconciliationResults: { some: { matchStatus: 'MATCHED' } },
      },
      _sum: { amount: true },
    });
    const unmatchedBank = await this.prisma.bankTransaction.aggregate({
      where: {
        ...scope.txnWhere,
        reconciliationResults: {
          some: { matchStatus: { in: EXCEPTION_STATUSES as never[] } },
        },
      },
      _sum: { amount: true },
    });
    const unmatchedTally = await this.prisma.tallyTransaction.aggregate({
      where: {
        companyId: scope.companyId,
        date: scope.txnWhere['transactionDate'] as object,
        reconciliationResults: {
          some: { matchStatus: { in: EXCEPTION_STATUSES as never[] } },
        },
      },
      _sum: { amount: true },
    });

    const counts = {
      matched: countBy(byStatus, 'statusOf', 'MATCHED'),
      possibleMatch: countBy(byStatus, 'statusOf', 'POSSIBLE_MATCH'),
      unmatched: countBy(byStatus, 'statusOf', 'UNMATCHED'),
      reviewRequired: countBy(byStatus, 'statusOf', 'REVIEW_REQUIRED'),
      amountMismatch: countBy(byStatus, 'statusOf', 'AMOUNT_MISMATCH'),
      dateMismatch: countBy(byStatus, 'statusOf', 'DATE_MISMATCH'),
      missingInTally: countBy(byStatus, 'statusOf', 'MISSING_IN_TALLY'),
      missingInBank: countBy(byStatus, 'statusOf', 'MISSING_IN_BANK'),
      pendingReview: countBy(byReview, 'reviewOf', 'PENDING_REVIEW'),
      inReview: countBy(byReview, 'reviewOf', 'IN_REVIEW'),
      confirmed: byReview
        .filter((g) => CONFIRMED_STATUSES.includes(reviewOf(g)))
        .reduce((acc: number, g) => acc + (g as { _count: { _all: number } })._count._all, 0),
      confirmedWrongParty: countBy(byReview, 'reviewOf', 'WRONG_PARTY'),
      confirmedDuplicate: countBy(byReview, 'reviewOf', 'DUPLICATE_CONFIRMED'),
      confirmedAmountMismatch: countBy(byReview, 'reviewOf', 'AMOUNT_MISMATCH_CONFIRMED'),
      confirmedDateMismatch: countBy(byReview, 'reviewOf', 'DATE_MISMATCH_CONFIRMED'),
      rejected: countBy(byReview, 'reviewOf', 'REJECTED'),
      ignored: countBy(byReview, 'reviewOf', 'IGNORED'),
    };
    const totalResults = byStatus.reduce(
      (acc: number, g) => acc + (g as { _count: { _all: number } })._count._all,
      0,
    );
    const exceptionTotal = EXCEPTION_STATUSES.reduce(
      (acc, s) => acc + countBy(byStatus, 'statusOf', s),
      0,
    );

    const statusChart = (
      Object.entries({
        MATCHED: counts.matched,
        POSSIBLE_MATCH: counts.possibleMatch,
        UNMATCHED: counts.unmatched,
        REVIEW_REQUIRED: counts.reviewRequired,
        AMOUNT_MISMATCH: counts.amountMismatch,
        DATE_MISMATCH: counts.dateMismatch,
        MISSING_IN_TALLY: counts.missingInTally,
        MISSING_IN_BANK: counts.missingInBank,
      }) as [string, number][]
    ).map(([status, count]) => ({ status, count }));

    const reviewChart = (
      Object.entries({
        CONFIRMED_MATCH: counts.confirmed,
        WRONG_PARTY: counts.confirmedWrongParty,
        DUPLICATE_CONFIRMED: counts.confirmedDuplicate,
        AMOUNT_MISMATCH_CONFIRMED: counts.confirmedAmountMismatch,
        DATE_MISMATCH_CONFIRMED: counts.confirmedDateMismatch,
        REJECTED: counts.rejected,
        IGNORED: counts.ignored,
        PENDING_REVIEW: counts.pendingReview,
      }) as [string, number][]
    ).map(([status, count]) => ({ status, count }));

    return {
      company: {
        id: company.id,
        companyName: company.companyName,
        currency: company.currency,
      },
      filters: JSON.parse(JSON.stringify(filter)) as Record<string, string | undefined>,
      kpis: {
        totalBankTransactions: totalBank,
        totalTallyTransactions: totalTally,
        totalResults,
        ...counts,
      },
      health: {
        total: totalResults,
        matchedPct:
          totalResults === 0
            ? '0.0%'
            : ((counts.matched / totalResults) * 100).toFixed(1) + '%',
        possiblePct:
          totalResults === 0
            ? '0.0%'
            : ((counts.possibleMatch / totalResults) * 100).toFixed(1) + '%',
        exceptionsPct:
          totalResults === 0
            ? '0.0%'
            : ((exceptionTotal / totalResults) * 100).toFixed(1) + '%',
        pendingPct:
          totalResults === 0
            ? '0.0%'
            : ((counts.pendingReview / totalResults) * 100).toFixed(1) + '%',
      },
      amounts: {
        totalBank: bankSum._sum.amount?.toString() ?? '0',
        totalTally: tallySum._sum.amount?.toString() ?? '0',
        matchedBank: matchedBank._sum.amount?.toString() ?? '0',
        unmatchedBank: unmatchedBank._sum.amount?.toString() ?? '0',
        unmatchedTally: unmatchedTally._sum.amount?.toString() ?? '0',
      },
      statusChart,
      reviewChart,
      bankAccounts: accounts,
    };
  }

  /** Per-account aggregates for the selected company. */
  async bankAccountSummary(userId: string, companyId: string, filter: ReportFilter) {
    await this.resolveScope(userId, companyId, filter);
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, ...(filter.bankAccountId ? { id: filter.bankAccountId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    const out = [];
    for (const account of accounts) {
      const txnWhere = {
        companyId,
        bankAccountId: account.id,
        ...(filter.fromDate || filter.toDate
          ? {
              transactionDate: {
                ...(filter.fromDate ? { gte: parseDay(filter.fromDate) } : {}),
                ...(filter.toDate
                  ? { lt: new Date((parseDay(filter.toDate)?.getTime() ?? 0) + DAY_MS) }
                  : {}),
              },
            }
          : {}),
      };
      const [txnCount, bankSum, matched, unmatched, pending, exceptions, tallySum] =
        await Promise.all([
          this.prisma.bankTransaction.count({ where: txnWhere }),
          this.prisma.bankTransaction.aggregate({ where: txnWhere, _sum: { amount: true } }),
          this.prisma.reconciliationResult.count({
            where: {
              run: { companyId, bankAccountId: account.id },
              matchStatus: 'MATCHED',
            },
          }),
          this.prisma.reconciliationResult.count({
            where: {
              run: { companyId, bankAccountId: account.id },
              matchStatus: { in: ['UNMATCHED', ...EXCEPTION_STATUSES] as never[] },
            },
          }),
          this.prisma.reconciliationResult.count({
            where: {
              run: { companyId, bankAccountId: account.id },
              reviewStatus: 'PENDING_REVIEW',
            },
          }),
          this.prisma.reconciliationResult.count({
            where: {
              run: { companyId, bankAccountId: account.id },
              matchStatus: { in: EXCEPTION_STATUSES as never[] },
            },
          }),
          this.prisma.tallyTransaction.aggregate({
            where: {
              companyId,
              ...(filter.fromDate || filter.toDate
                ? {
                    date: {
                      ...(filter.fromDate ? { gte: parseDay(filter.fromDate) } : {}),
                      ...(filter.toDate
                        ? { lt: new Date((parseDay(filter.toDate)?.getTime() ?? 0) + DAY_MS) }
                        : {}),
                    },
                  }
                : {}),
            },
            _sum: { amount: true },
          }),
        ]);
      out.push({
        bankAccountId: account.id,
        bankName: account.bankName,
        accountName: account.accountName,
        transactions: txnCount,
        bankAmount: bankSum._sum.amount?.toString() ?? '0',
        tallyAmount: tallySum._sum.amount?.toString() ?? '0',
        matched,
        unmatched,
        pendingReview: pending,
        exceptions,
        difference: new Decimal(bankSum._sum.amount?.toString() ?? '0')
          .minus(new Decimal(tallySum._sum.amount?.toString() ?? '0'))
          .toString(),
      });
    }
    return out;
  }

  /** Monthly trend from actual result rows (raw SQL date_trunc). */
  async monthlyTrend(userId: string, companyId: string, filter: ReportFilter) {
    const scope = await this.resolveScope(userId, companyId, filter);
    const accountClause = filter.bankAccountId
      ? 'AND r2."bankAccountId" = $2'
      : '';
    const params: (string | Date)[] = [scope.companyId, scope.from, scope.toExclusive];
    if (filter.bankAccountId) params.push(filter.bankAccountId);
    const rows = await this.prisma.$queryRawUnsafe<
      { month: Date; total: bigint; matched: bigint; exceptions: bigint; pending: bigint; confirmed: bigint }[]>(
      `SELECT date_trunc('month', COALESCE(bt."transactionDate", tt."date")) AS month,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE r."matchStatus" = 'MATCHED') AS matched,
              COUNT(*) FILTER (WHERE r."matchStatus" IN ('AMOUNT_MISMATCH','DATE_MISMATCH','REVIEW_REQUIRED','MISSING_IN_TALLY','MISSING_IN_BANK')) AS exceptions,
              COUNT(*) FILTER (WHERE r."reviewStatus" = 'PENDING_REVIEW') AS pending,
              COUNT(*) FILTER (WHERE r."reviewStatus" IN ('CONFIRMED_MATCH','WRONG_PARTY','DUPLICATE_CONFIRMED','AMOUNT_MISMATCH_CONFIRMED','DATE_MISMATCH_CONFIRMED','MISSING_IN_TALLY_CONFIRMED','MISSING_IN_BANK_CONFIRMED')) AS confirmed
       FROM "ReconciliationResult" r
       LEFT JOIN "BankTransaction" bt ON bt.id = r."bankTransactionId"
       LEFT JOIN "TallyTransaction" tt ON tt.id = r."tallyTransactionId"
       WHERE r."reconciliationRunId" IN (
         SELECT id FROM "ReconciliationRun" r2
         WHERE r2."companyId" = $1 ${accountClause}
       )
         AND COALESCE(bt."transactionDate", tt."date") >= $2
         AND COALESCE(bt."transactionDate", tt."date") < $3
       GROUP BY 1
       ORDER BY 1`,
      ...params,
    );
    return rows.map((r) => ({
      month: r.month.toISOString().slice(0, 7),
      total: Number(r.total),
      matched: Number(r.matched),
      exceptions: Number(r.exceptions),
      pendingReview: Number(r.pending),
      confirmed: Number(r.confirmed),
    }));
  }

  /** Parties with exceptions from real reconciliation data. */
  async partyExceptions(userId: string, companyId: string, filter: ReportFilter) {
    const scope = await this.resolveScope(userId, companyId, filter);
    const accountClause = filter.bankAccountId
      ? 'AND r2."bankAccountId" = $2'
      : '';
    const params: (string | Date)[] = [scope.companyId];
    if (filter.bankAccountId) params.push(filter.bankAccountId);
    const rows = await this.prisma.$queryRawUnsafe<
      {
        party: string;
        txn_count: bigint;
        total_amount: string | null;
        wrong_party: bigint;
        confirmed_wrong_party: bigint;
        duplicate_candidates: bigint;
        amount_mismatches: bigint;
        review_required: bigint;
      }[]>(
      `SELECT COALESCE(tt."normalizedParty", bt."normalizedNarration", 'UNKNOWN') AS party,
              COUNT(DISTINCT r."id") AS txn_count,
              SUM(COALESCE(bt."amount", tt."amount")) AS total_amount,
              COUNT(DISTINCT r."id") FILTER (WHERE r."matchStatus" = 'AMOUNT_MISMATCH' AND r."evidence"->>'party' = 'MISMATCH') AS wrong_party,
              COUNT(DISTINCT r."id") FILTER (WHERE r."reviewStatus" = 'WRONG_PARTY') AS confirmed_wrong_party,
              COUNT(DISTINCT r."id") FILTER (WHERE r."matchType" = 'DUPLICATE_CANDIDATE') AS duplicate_candidates,
              COUNT(DISTINCT r."id") FILTER (WHERE r."matchStatus" = 'AMOUNT_MISMATCH') AS amount_mismatches,
              COUNT(DISTINCT r."id") FILTER (WHERE r."matchStatus" = 'REVIEW_REQUIRED') AS review_required
       FROM "ReconciliationResult" r
       LEFT JOIN "BankTransaction" bt ON bt.id = r."bankTransactionId"
       LEFT JOIN "TallyTransaction" tt ON tt.id = r."tallyTransactionId"
       WHERE r."reconciliationRunId" IN (
         SELECT id FROM "ReconciliationRun" r2
         WHERE r2."companyId" = $1 ${accountClause}
       )
         AND (
           r."matchStatus" IN ('REVIEW_REQUIRED','AMOUNT_MISMATCH','DATE_MISMATCH','MISSING_IN_TALLY','MISSING_IN_BANK','POSSIBLE_MATCH')
           OR r."reviewStatus" IN ('WRONG_PARTY','DUPLICATE_CONFIRMED')
         )
       GROUP BY 1
       ORDER BY txn_count DESC, 1
       LIMIT 100`,
      ...params,
    );
    return rows.map((r) => ({
      party: r.party,
      transactionCount: Number(r.txn_count),
      totalAmount: r.total_amount ?? '0',
      wrongPartyCandidates: Number(r.wrong_party),
      confirmedWrongParty: Number(r.confirmed_wrong_party),
      duplicateCandidates: Number(r.duplicate_candidates),
      amountMismatches: Number(r.amount_mismatches),
      reviewRequired: Number(r.review_required),
    }));
  }

  /** AI exception statistics — advisory only, never confirmed errors. */
  async aiSummary(userId: string, companyId: string) {
    await this.requireMembership(userId, companyId);
    const [byClass, byRisk, total, high, medium, low] = await Promise.all([
      this.prisma.aIAnalysis.groupBy({
        by: ['classification'],
        where: { result: { run: { companyId } } },
        _count: { _all: true },
      }),
      this.prisma.aIAnalysis.groupBy({
        by: ['riskLevel'],
        where: { result: { run: { companyId } } },
        _count: { _all: true },
      }),
      this.prisma.aIAnalysis.count({ where: { result: { run: { companyId } } } }),
      this.prisma.aIAnalysis.count({
        where: { result: { run: { companyId } }, aiConfidence: { gte: 0.85 } },
      }),
      this.prisma.aIAnalysis.count({
        where: { result: { run: { companyId } }, aiConfidence: { gte: 0.6, lt: 0.85 } },
      }),
      this.prisma.aIAnalysis.count({
        where: { result: { run: { companyId } }, aiConfidence: { lt: 0.6 } },
      }),
    ]);
    const classOf = (g: unknown) =>
      (g as { classification?: string }).classification ?? '';
    const riskOf = (g: unknown) => (g as { riskLevel?: string }).riskLevel ?? '';
    const byClassification = Object.fromEntries(
      byClass.map((g) => [classOf(g), (g as { _count: { _all: number } })._count._all]),
    );
    return {
      total,
      byClassification: {
        wrongPartyCandidates: byClassification['WRONG_PARTY_CANDIDATE'] ?? 0,
        duplicateCandidates: byClassification['DUPLICATE_CANDIDATE'] ?? 0,
        amountAnomalies: byClassification['AMOUNT_ANOMALY'] ?? 0,
        dateAnomalies: byClassification['DATE_ANOMALY'] ?? 0,
        narrationAnomalies: byClassification['NARRATION_ANOMALY'] ?? 0,
        noException: byClassification['NO_EXCEPTION'] ?? 0,
        reviewRequired: byClassification['REVIEW_REQUIRED'] ?? 0,
      },
      byRisk: {
        high: byRisk.find((g) => riskOf(g) === 'HIGH')
          ?._count._all ?? 0,
        medium: byRisk.find((g) => riskOf(g) === 'MEDIUM')
          ?._count._all ?? 0,
        low: byRisk.find((g) => riskOf(g) === 'LOW')
          ?._count._all ?? 0,
      },
      confidenceDistribution: { high, medium, low },
      disclaimer:
        'AI ASSISTED / REVIEW REQUIRED — AI findings are advisory and require accountant review.',
    };
  }

  /** Result rows for exports (capped for memory safety). */
  async exportRows(userId: string, companyId: string, filter: ReportFilter) {
    const scope = await this.resolveScope(userId, companyId, filter);
    const rows = await this.prisma.reconciliationResult.findMany({
      where: scope.resultWhere,
      include: {
        bankTransaction: true,
        tallyTransaction: true,
        links: { include: { bankTransaction: true, tallyTransaction: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT_ROWS,
    });
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    const aiRows = await this.prisma.aIAnalysis.findMany({
      where: { result: { run: scope.runWhere } },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT_ROWS,
    });
    const reviewRows = await this.prisma.reviewAction.findMany({
      where: { companyId, reconciliationResultId: { in: rows.map((r) => r.id) } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT_ROWS,
    });
    return {
      companyName: company?.companyName ?? '',
      rows: rows.map((r) => ({
        bankDate: r.bankTransaction?.transactionDate ?? null,
        bankValueDate: r.bankTransaction?.valueDate ?? null,
        bankDescription: r.bankTransaction?.narration ?? r.bankTransaction?.description ?? null,
        bankReference: r.bankTransaction?.reference ?? null,
        bankDebit: r.bankTransaction?.debit?.toString() ?? null,
        bankCredit: r.bankTransaction?.credit?.toString() ?? null,
        bankAmount: r.bankTransaction?.amount?.toString() ?? null,
        tallyDate: r.tallyTransaction?.date ?? null,
        voucherNo: r.tallyTransaction?.voucherNo ?? null,
        voucherType: r.tallyTransaction?.voucherType ?? null,
        party: r.tallyTransaction?.party ?? null,
        ledger: r.tallyTransaction?.ledger ?? null,
        tallyReference: r.tallyTransaction?.reference ?? null,
        tallyAmount: r.tallyTransaction?.amount?.toString() ?? null,
        matchStatus: r.matchStatus,
        matchType: r.matchType,
        confidence: r.confidence,
        reviewStatus: r.reviewStatus,
        aiClassification: aiRows.find((a) => a.reconciliationResultId === r.id)?.classification ?? null,
        aiConfidence: aiRows.find((a) => a.reconciliationResultId === r.id)?.aiConfidence?.toString() ?? null,
        risk: aiRows.find((a) => a.reconciliationResultId === r.id)?.riskLevel ?? null,
        reason: r.matchReason,
        reviewer: reviewRows.filter((v) => v.reconciliationResultId === r.id).at(-1)?.user?.name ?? null,
        reviewDate: reviewRows.filter((v) => v.reconciliationResultId === r.id).at(-1)?.createdAt ?? null,
        reviewComment: reviewRows.filter((v) => v.reconciliationResultId === r.id).at(-1)?.comment ?? null,
      })),
      aiRows: aiRows.map((a) => ({
        classification: a.classification,
        aiConfidence: a.aiConfidence?.toString() ?? null,
        riskLevel: a.riskLevel,
        reason: a.reason,
        recommendedAction: a.recommendedAction,
        provider: a.provider,
        model: a.model,
        createdAt: a.createdAt,
      })),
      reviewRows,
    };
  }

  async auditExport(
    userId: string,
    companyId: string,
    reportType: string,
    format: string,
    filter: ReportFilter,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'REPORT_EXPORTED',
        entity: 'Report',
        entityId: reportType,
        newValue: {
          reportType,
          format,
          filters: filter as unknown as Record<string, string | undefined>,
        },
      },
    });
  }
}
