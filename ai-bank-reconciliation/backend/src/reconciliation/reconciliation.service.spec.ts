import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyRole, ImportStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ReconciliationRunGuard } from './reconciliation-run.guard.js';
import { ReconciliationService } from './reconciliation.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const account = { id: ACCOUNT_ID, companyId: COMPANY_ID };

function bankRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyId: COMPANY_ID,
    bankAccountId: ACCOUNT_ID,
    importId: 'import-1',
    transactionDate: new Date('2026-09-18T00:00:00.000Z'),
    valueDate: null,
    description: null,
    narration: 'NEFT ABC Traders',
    chequeNumber: null,
    reference: 'UTR1',
    debit: '75000',
    credit: null,
    amount: '75000',
    direction: 'DEBIT',
    balance: null,
    originalRow: {},
    normalizedNarration: 'NEFT ABC TRADERS',
    normalizedReference: 'UTR1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

function tallyRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyId: COMPANY_ID,
    voucherId: 'remote-1',
    voucherNo: '1',
    date: new Date('2026-09-18T00:00:00.000Z'),
    ledger: 'ABC Traders',
    bankLedger: 'HDFC Bank',
    voucherType: 'Payment',
    direction: 'DEBIT',
    amount: '75000',
    reference: 'UTR1',
    narration: 'Test',
    party: 'ABC Traders',
    normalizedParty: 'ABC TRADERS',
    identityHash: `hash-${id}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    reconciliationRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    bankTransaction: { findMany: vi.fn() },
    tallyTransaction: { findMany: vi.fn() },
    reconciliationResult: { createMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    reconciliationResultLink: { createMany: vi.fn() },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function httpContext(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

describe('ReconciliationService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
  });

  const service = () =>
    new ReconciliationService(prisma as unknown as PrismaService);

  function primeRunFlow(role: CompanyRole = CompanyRole.OWNER) {
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role,
    });
    const run = {
      id: RUN_ID,
      companyId: COMPANY_ID,
      bankAccountId: ACCOUNT_ID,
      fromDate: new Date('2026-09-01T00:00:00.000Z'),
      toDate: new Date('2026-09-30T00:00:00.000Z'),
      dateToleranceDays: 2,
      status: ImportStatus.PENDING,
      config: null,
    };
    prisma.reconciliationRun.create.mockResolvedValue(run);
    let current = { ...run };
    prisma.reconciliationRun.findUnique.mockImplementation(async () => ({
      ...current,
    }));
    prisma.reconciliationRun.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => {
        current = { ...current, ...args.data };
        return { ...current };
      },
    );
    prisma.bankTransaction.findMany.mockResolvedValue([bankRow('b1')]);
    prisma.tallyTransaction.findMany.mockResolvedValue([tallyRow('t1')]);
    prisma.reconciliationResult.createMany.mockResolvedValue({ count: 1 });
    return run;
  }

  it('15. rejects cross-company runs and reads', async () => {
    prisma.bankAccount.findUnique.mockResolvedValue({
      ...account,
      companyId: 'other-company',
    });
    prisma.companyUser.findUnique.mockResolvedValue(null);

    await expect(
      service().createRun(USER_ID, {
        bankAccountId: ACCOUNT_ID,
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const guard = new ReconciliationRunGuard(
      prisma as unknown as PrismaService,
    );
    prisma.reconciliationRun.findUnique.mockResolvedValue({
      id: RUN_ID,
      companyId: 'other-company',
    });
    await expect(
      guard.canActivate(
        httpContext({ params: { id: RUN_ID }, user: { id: USER_ID } }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only owners and accountants can start runs', async () => {
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: CompanyRole.VIEWER,
    });

    await expect(
      service().createRun(USER_ID, {
        bankAccountId: ACCOUNT_ID,
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('persists run counts after a live engine pass', async () => {
    primeRunFlow();

    const created = await service().createRun(USER_ID, {
      bankAccountId: ACCOUNT_ID,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    expect(created.status).toBe(ImportStatus.COMPLETED);

    const update = prisma.reconciliationRun.update.mock.calls.at(-1)?.[0]
      .data as Record<string, unknown>;
    expect(update).toMatchObject({
      status: ImportStatus.COMPLETED,
      totalBankTransactions: 1,
      totalTallyTransactions: 1,
      matchedCount: 1,
    });
    expect(prisma.reconciliationResult.createMany).toHaveBeenCalled();
  });

  it('filters results by status and party', async () => {
    prisma.reconciliationRun.findUnique.mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
    });
    prisma.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: CompanyRole.VIEWER,
    });
    prisma.reconciliationResult.count.mockResolvedValue(1);
    prisma.reconciliationResult.findMany.mockResolvedValue([]);

    await service().listResults(USER_ID, RUN_ID, {
      status: 'MATCHED',
      party: 'ABC',
    } as never);

    expect(prisma.reconciliationResult.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ matchStatus: 'MATCHED' }),
      }),
    );
  });

  it('reviewers and viewers can read runs', async () => {
    prisma.companyUser.findUnique.mockResolvedValue({
      id: 'm-1',
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: CompanyRole.REVIEWER,
    });
    prisma.reconciliationRun.findMany.mockResolvedValue([]);

    await expect(
      service().listRuns(USER_ID, COMPANY_ID),
    ).resolves.toEqual([]);
  });
});
