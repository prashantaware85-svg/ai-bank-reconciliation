import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import * as XLSX from 'xlsx';
import { CompanyRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { formatINR, percent } from './format.js';
import { buildExceptionsWorkbook, buildWorkbook, type ExportBundle } from './excel-export.js';
import {
  buildExceptionPdf,
  buildReviewPdf,
  buildSummaryPdf,
} from './pdf-export.js';
import { ReportsService } from './reports.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ACCOUNT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn(), findMany: vi.fn() },
    bankTransaction: { count: vi.fn(), aggregate: vi.fn() },
    tallyTransaction: { count: vi.fn(), aggregate: vi.fn() },
    reconciliationResult: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    aIAnalysis: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    reviewAction: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function agg(count: number, sum?: string) {
  return {
    _count: { _all: count },
    _sum: { amount: sum === undefined ? null : new Decimal(sum) },
  };
}

function group(matchStatus: string, count: number) {
  return { matchStatus, reviewStatus: undefined, _count: { _all: count } };
}

function reviewGroup(reviewStatus: string, count: number) {
  return { reviewStatus, _count: { _all: count } };
}

describe('ReportsService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
    prisma.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: CompanyRole.VIEWER,
    });
    prisma.company.findUnique.mockResolvedValue({
      id: COMPANY_ID,
      companyName: 'Test Co',
      currency: 'INR',
    });
    prisma.bankAccount.findUnique.mockResolvedValue({
      id: ACCOUNT_ID,
      companyId: COMPANY_ID,
    });
    prisma.bankAccount.findMany.mockResolvedValue([
      { id: ACCOUNT_ID, companyId: COMPANY_ID, bankName: 'HDFC', accountName: 'Current' },
    ]);
    // Bank side: 10 txns, total 125000.
    prisma.bankTransaction.count.mockResolvedValue(10);
    prisma.bankTransaction.aggregate.mockResolvedValue(agg(10, '125000'));
    // Tally side: 8 txns, total 120000.
    prisma.tallyTransaction.count.mockResolvedValue(8);
    prisma.tallyTransaction.aggregate.mockResolvedValue(agg(8, '120000'));
    // Results: 6 MATCHED, 2 POSSIBLE, 1 REVIEW_REQUIRED, 1 AMOUNT_MISMATCH.
    prisma.reconciliationResult.groupBy
      .mockImplementationOnce(async () => [
        group('MATCHED', 6),
        group('POSSIBLE_MATCH', 2),
        group('REVIEW_REQUIRED', 1),
        group('AMOUNT_MISMATCH', 1),
      ])
      .mockImplementationOnce(async () => [
        reviewGroup('PENDING_REVIEW', 4),
        reviewGroup('CONFIRMED_MATCH', 3),
        reviewGroup('REJECTED', 1),
      ]);
    // Result detail queries (matched/unmatched aggregates etc.).
    prisma.reconciliationResult.count.mockResolvedValue(0);
    prisma.aIAnalysis.groupBy.mockResolvedValue([]);
    prisma.aIAnalysis.count.mockResolvedValue(0);
    prisma.reviewAction.findMany.mockResolvedValue([]);
    prisma.reconciliationResult.findMany.mockResolvedValue([]);
    prisma.aIAnalysis.findMany.mockResolvedValue([]);
    prisma.$queryRawUnsafe.mockResolvedValue([]);
  });

  const service = () =>
    new ReportsService(prisma as unknown as PrismaService);

  it('1/2/3. dashboard totals + status + review aggregation from DB', async () => {
    const dash = await service().dashboard(USER_ID, COMPANY_ID, {});

    expect(dash.kpis.totalBankTransactions).toBe(10);
    expect(dash.kpis.totalTallyTransactions).toBe(8);
    expect(dash.kpis.matched).toBe(6);
    expect(dash.kpis.possibleMatch).toBe(2);
    expect(dash.kpis.reviewRequired).toBe(1);
    expect(dash.kpis.amountMismatch).toBe(1);
    expect(dash.kpis.pendingReview).toBe(4);
    expect(dash.kpis.confirmed).toBe(3);
    expect(dash.kpis.rejected).toBe(1);
    // groupBy was used (server-side aggregation, not frontend math).
    expect(prisma.reconciliationResult.groupBy).toHaveBeenCalled();
  });

  it('4. amounts use Decimal and are exact', async () => {
    const dash = await service().dashboard(USER_ID, COMPANY_ID, {});
    expect(dash.amounts.totalBank).toBe('125000');
    expect(dash.amounts.totalTally).toBe('120000');
    // Decimal arithmetic — no float error.
    expect(
      new Decimal(dash.amounts.totalBank)
        .minus(dash.amounts.totalTally)
        .toString(),
    ).toBe('5000');
  });

  it('5. monthly trend comes from raw SQL aggregation', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { month: new Date('2026-08-01T00:00:00.000Z'), total: 12n, matched: 9n, exceptions: 2n, pending: 1n, confirmed: 8n },
      { month: new Date('2026-09-01T00:00:00.000Z'), total: 15n, matched: 12n, exceptions: 2n, pending: 1n, confirmed: 11n },
    ]);
    const trend = await service().monthlyTrend(USER_ID, COMPANY_ID, {});
    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({
      month: '2026-08',
      total: 12,
      matched: 9,
      exceptions: 2,
      pendingReview: 1,
      confirmed: 8,
    });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('6. bank account summary aggregates per account', async () => {
    prisma.bankTransaction.count.mockResolvedValue(5);
    prisma.bankTransaction.aggregate.mockResolvedValue(agg(5, '60000'));
    prisma.tallyTransaction.aggregate.mockResolvedValue(agg(5, '58500'));
    prisma.reconciliationResult.count.mockImplementation(
      async (args: { where: { matchStatus?: unknown } }) => {
        const status = args.where.matchStatus as
          | string
          | { in?: string[] }
          | undefined;
        if (status === 'MATCHED') return 4;
        if (status && typeof status === 'object' && Array.isArray(status.in)) return 1;
        return 2;
      },
    );
    const summary = await service().bankAccountSummary(USER_ID, COMPANY_ID, {});
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      bankName: 'HDFC',
      transactions: 5,
      bankAmount: '60000',
      tallyAmount: '58500',
      matched: 4,
    });
    expect(summary[0]?.difference).toBe('1500');
  });

  it('7. party exception summary from real data', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        party: 'ABC TRADERS',
        txn_count: 3n,
        total_amount: '100000.00',
        wrong_party: 1n,
        confirmed_wrong_party: 0n,
        duplicate_candidates: 1n,
        amount_mismatches: 1n,
        review_required: 1n,
      },
    ]);
    const report = await service().partyExceptions(USER_ID, COMPANY_ID, {});
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      party: 'ABC TRADERS',
      transactionCount: 3,
      wrongPartyCandidates: 1,
      duplicateCandidates: 1,
      amountMismatches: 1,
      reviewRequired: 1,
    });
  });

  it('8. AI summary is advisory with confidence distribution', async () => {
    prisma.aIAnalysis.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    prisma.aIAnalysis.groupBy.mockResolvedValue([
      { classification: 'WRONG_PARTY_CANDIDATE', _count: { _all: 7 } },
      { classification: 'NO_EXCEPTION', _count: { _all: 3 } },
    ]);
    const summary = await service().aiSummary(USER_ID, COMPANY_ID);
    expect(summary.total).toBe(10);
    expect(summary.byClassification.wrongPartyCandidates).toBe(7);
    expect(summary.confidenceDistribution).toEqual({ high: 6, medium: 3, low: 1 });
    expect(summary.disclaimer).toMatch('advisory');
  });

  it('9. company isolation — foreign company yields 404', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(null);
    await expect(
      service().dashboard(USER_ID, 'other-company', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('10. bank account ownership verified', async () => {
    prisma.bankAccount.findUnique.mockResolvedValue({
      id: OTHER_ACCOUNT_ID,
      companyId: 'other-company',
    });
    await expect(
      service().dashboard(USER_ID, COMPANY_ID, { bankAccountId: OTHER_ACCOUNT_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('15. invalid date ranges rejected', async () => {
    await expect(
      service().dashboard(USER_ID, COMPANY_ID, { fromDate: '2026-13-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service().dashboard(USER_ID, COMPANY_ID, {
        fromDate: '2026-09-30',
        toDate: '2026-09-01',
      }),
    ).rejects.toThrow('fromDate must not be after toDate');
  });

  it('14. empty dataset handled safely', async () => {
    prisma.bankTransaction.count.mockResolvedValue(0);
    prisma.bankTransaction.aggregate.mockResolvedValue(agg(0));
    prisma.tallyTransaction.count.mockResolvedValue(0);
    prisma.tallyTransaction.aggregate.mockResolvedValue(agg(0));
    // Reset the once-queue from beforeEach, then return empty groups.
    prisma.reconciliationResult.groupBy.mockReset();
    prisma.reconciliationResult.groupBy.mockResolvedValue([]);
    prisma.reconciliationResult.count.mockResolvedValue(0);
    const dash = await service().dashboard(USER_ID, COMPANY_ID, {});
    expect(dash.kpis.totalBankTransactions).toBe(0);
    expect(dash.health.matchedPct).toBe('0.0%');
    expect(dash.amounts.totalBank).toBe('0');

    const trend = await service().monthlyTrend(USER_ID, COMPANY_ID, {});
    expect(trend).toEqual([]);
  });

  it('20. viewer can access reports (read-only policy)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: CompanyRole.VIEWER,
    });
    await expect(
      service().dashboard(USER_ID, COMPANY_ID, {}),
    ).resolves.toBeDefined();
  });

  it('13. export filters narrow results', async () => {
    prisma.reconciliationResult.findMany.mockResolvedValue([]);
    await service().exportRows(USER_ID, COMPANY_ID, {
      status: 'REVIEW_REQUIRED',
      bankAccountId: ACCOUNT_ID,
    });
    const where = prisma.reconciliationResult.findMany.mock.calls[0][0]
      .where as Record<string, unknown>;
    expect(where['matchStatus']).toBe('REVIEW_REQUIRED');
    expect((where['run'] as Record<string, unknown>)['bankAccountId']).toBe(
      ACCOUNT_ID,
    );
  });
});

describe('Indian currency formatting', () => {
  it('17. formats lakh/crore grouping correctly', () => {
    expect(formatINR('125000')).toBe('₹1,25,000.00');
    expect(formatINR('1250000')).toBe('₹12,50,000.00');
    expect(formatINR('12500000')).toBe('₹1,25,00,000.00');
    expect(formatINR('0')).toBe('₹0.00');
    expect(formatINR('5000')).toBe('₹5,000.00');
    expect(formatINR(null)).toBe('—');
    expect(percent(924, 1000)).toBe('92.4%');
  });
});

describe('exports', () => {
  const bundle: ExportBundle = {
    companyName: 'Test Co',
    rows: [
      {
        bankDate: new Date('2026-09-18T00:00:00.000Z'),
        bankValueDate: new Date('2026-09-18T00:00:00.000Z'),
        bankDescription: 'NEFT ABC Traders',
        bankReference: 'HDFC123456',
        bankDebit: '75000',
        bankCredit: null,
        bankAmount: '75000',
        tallyDate: new Date('2026-09-17T00:00:00.000Z'),
        voucherNo: '12',
        voucherType: 'Payment',
        party: 'XYZ Traders',
        ledger: 'XYZ Traders',
        tallyReference: null,
        tallyAmount: '75000',
        matchStatus: 'REVIEW_REQUIRED',
        matchType: 'ONE_TO_ONE',
        confidence: 40,
        reviewStatus: 'PENDING_REVIEW',
        aiClassification: 'WRONG_PARTY_CANDIDATE',
        aiConfidence: '0.91',
        risk: 'HIGH',
        reason: 'Party evidence is not consistent.',
        reviewer: 'Prashant',
        reviewDate: new Date('2026-10-01T10:00:00.000Z'),
        reviewComment: 'Reviewing',
      },
      {
        bankDate: new Date('2026-09-19T00:00:00.000Z'),
        bankValueDate: null,
        bankDescription: 'Matched row',
        bankReference: 'UTR1',
        bankDebit: null,
        bankCredit: '1000',
        bankAmount: '1000',
        tallyDate: new Date('2026-09-19T00:00:00.000Z'),
        voucherNo: '13',
        voucherType: 'Receipt',
        party: 'ABC',
        ledger: 'ABC',
        tallyReference: 'UTR1',
        tallyAmount: '1000',
        matchStatus: 'MATCHED',
        matchType: 'ONE_TO_ONE',
        confidence: 100,
        reviewStatus: 'CONFIRMED_MATCH',
        aiClassification: null,
        aiConfidence: null,
        risk: null,
        reason: 'Matched.',
        reviewer: null,
        reviewDate: null,
        reviewComment: null,
      },
    ],
    aiRows: [
      {
        classification: 'WRONG_PARTY_CANDIDATE',
        aiConfidence: '0.91',
        riskLevel: 'HIGH',
        reason: 'Party evidence is not consistent.',
        recommendedAction: 'Review Tally party allocation',
        provider: 'mock',
        model: 'mock-1',
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ],
    reviewRows: [
      {
        action: 'START_REVIEW',
        previousStatus: 'PENDING_REVIEW',
        newStatus: 'IN_REVIEW',
        comment: null,
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
        user: { name: 'Prashant', email: 'p@example.com' },
      },
    ],
    summary: {
      'Total Bank Transactions': 2,
      'Total Bank Amount': '₹76,000.00',
    },
    filters: { fromDate: '2026-09-01', toDate: '2026-09-30' },
    footer: [
      'Generated by AI Bank Reconciliation Tool',
      'AI-assisted findings are advisory and require accountant review.',
    ],
  };

  it('11. Excel export builds a multi-sheet workbook', () => {
    const buf = buildWorkbook(bundle);
    expect(buf.length).toBeGreaterThan(1000);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual([
      'Summary',
      'Reconciliation',
      'Exceptions',
      'Review History',
      'AI Analysis',
    ]);
    const sheet = wb.Sheets['Reconciliation'] as XLSX.WorkSheet;
    expect(sheet['!autofilter']).toBeTruthy();
    // Numeric cell with Indian currency rendering (w = formatted text).
    const amountCell = sheet['G2'] as XLSX.CellObject;
    expect(amountCell.t).toBe('n');
    expect(amountCell.w).toBe('₹75,000.00');
    // Header row is present.
    const headerCell = sheet['A1'] as XLSX.CellObject;
    expect(headerCell.v).toBe('Bank Date');
  });

  it('exceptions workbook narrows to exception rows', () => {
    const buf = buildExceptionsWorkbook(bundle);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets['Reconciliation'] as XLSX.WorkSheet;
    expect(sheet['!ref']).toBe('A1:Y2');
  });

  it('12. PDF exports generate valid documents', async () => {
    const summary = await buildSummaryPdf(bundle);
    expect(summary.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const exceptions = await buildExceptionPdf(bundle);
    expect(exceptions.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(exceptions.length).toBeGreaterThan(500);
    const review = await buildReviewPdf(bundle);
    expect(review.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('exports contain no secrets', () => {
    const buf = buildWorkbook(bundle).toString('latin1');
    expect(buf).not.toMatch(/password/i);
    expect(buf).not.toMatch(/Bearer /);
    expect(buf).not.toMatch(/AI_API_KEY/);
    expect(buf).toContain('Generated by AI Bank Reconciliation Tool');
    expect(buf).toContain('advisory and require accountant review');
  });

  it('18. export events are audited', async () => {
    const prismaMock = makePrismaMock();
    const svc = new ReportsService(prismaMock as unknown as PrismaService);
    await svc.auditExport(USER_ID, COMPANY_ID, 'RECONCILIATION', 'XLSX', {
      bankAccountId: ACCOUNT_ID,
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REPORT_EXPORTED',
          entity: 'Report',
        }),
      }),
    );
  });

  it('19. export rows are capped (memory-safe)', async () => {
    const prismaMock = makePrismaMock();
    prismaMock.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: CompanyRole.VIEWER,
    });
    prismaMock.company.findUnique.mockResolvedValue({
      id: COMPANY_ID,
      companyName: 'Test Co',
    });
    prismaMock.reconciliationResult.findMany.mockResolvedValue([]);
    prismaMock.aIAnalysis.findMany.mockResolvedValue([]);
    prismaMock.reviewAction.findMany.mockResolvedValue([]);
    const svc = new ReportsService(prismaMock as unknown as PrismaService);
    await svc.exportRows(USER_ID, COMPANY_ID, {});
    const take = prismaMock.reconciliationResult.findMany.mock.calls[0][0]
      .take as number;
    expect(take).toBeLessThanOrEqual(20000);
  });
});
