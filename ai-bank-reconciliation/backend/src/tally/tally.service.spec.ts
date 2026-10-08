import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompanyRole,
  ImportStatus,
  TallyConnectionStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TallyTxnDto } from './dto/ingest-sync.dto.js';
import { TallyConnectionGuard } from './tally-connection.guard.js';
import { TallySyncService } from './tally-sync.service.js';
import { TallyService } from './tally.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OUTSIDER_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONNECTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SYNC_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const connection = {
  id: CONNECTION_ID,
  companyId: COMPANY_ID,
  name: 'Head Office Tally',
  status: TallyConnectionStatus.DISCONNECTED,
  connectorId: 'abc123',
  lastSyncAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    tallyConnection: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    tallySync: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tallyTransaction: { create: vi.fn(), findUnique: vi.fn() },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function membership(role: CompanyRole) {
  return { id: 'm-1', userId: USER_ID, companyId: COMPANY_ID, role };
}

function httpContext(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

function trackSyncUpdates(
  prisma: PrismaMock,
  sync: Record<string, unknown>,
) {
  const counts: Record<string, number> = {
    recordsReceived: 0,
    recordsImported: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
  };
  prisma.tallySync.update.mockImplementation(
    async (args: { data: Record<string, unknown> }) => {
      for (const key of Object.keys(counts)) {
        const value = args.data[key] as
          | { increment: number }
          | number
          | undefined;
        if (typeof value === 'number') counts[key] = value;
        else if (value && typeof value.increment === 'number') {
          (counts[key] as number) += value.increment;
        }
      }
      return { ...sync, ...counts, status: args.data['status'] ?? sync['status'], completedAt: args.data['completedAt'] };
    },
  );
}

const txn = (overrides: Partial<TallyTxnDto> = {}): TallyTxnDto => ({
  voucherId: 'remote-1',
  voucherNo: '1',
  date: '2026-09-05',
  ledger: 'ABC Traders',
  bankLedger: 'HDFC Bank',
  voucherType: 'Payment',
  direction: 'DEBIT',
  amount: '5000',
  reference: 'UTR1',
  narration: 'Test narration',
  party: 'ABC Traders Pvt. Ltd.',
  ...overrides,
});

describe('TallyService + TallySyncService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
  });

  const connections = () =>
    new TallyService(prisma as unknown as PrismaService);
  const syncs = () =>
    new TallySyncService(prisma as unknown as PrismaService);

  it('1. creates a Tally connection (owner)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.tallyConnection.create.mockResolvedValue(connection);

    const result = await connections().create(USER_ID, COMPANY_ID, {
      name: 'Head Office Tally',
    });

    expect(result.status).toBe(TallyConnectionStatus.DISCONNECTED);
    expect(result.connectorId).toBeTruthy();
    expect(prisma.tallyConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: COMPANY_ID }),
      }),
    );
  });

  it('2. rejects cross-company access', async () => {
    prisma.tallyConnection.findUnique.mockResolvedValue({
      ...connection,
      companyId: 'other-company',
    });
    prisma.companyUser.findUnique.mockResolvedValue(null);

    await expect(
      connections().getById(OUTSIDER_ID, CONNECTION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    const guard = new TallyConnectionGuard(
      prisma as unknown as PrismaService,
    );
    await expect(
      guard.canActivate(
        httpContext({
          params: { id: CONNECTION_ID },
          user: { id: OUTSIDER_ID },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('3. enforces role permissions', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(
      membership('ACCOUNTANT'),
    );
    prisma.tallyConnection.create.mockResolvedValue(connection);
    await expect(
      connections().create(USER_ID, COMPANY_ID, { name: 'X' }),
    ).resolves.toBeDefined();

    prisma.companyUser.findUnique.mockResolvedValue(membership('REVIEWER'));
    await expect(
      connections().create(USER_ID, COMPANY_ID, { name: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.tallyConnection.findUnique.mockResolvedValue(connection);
    await expect(
      connections().remove(USER_ID, CONNECTION_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.tallyConnection.delete.mockResolvedValue(connection);
    await expect(
      connections().remove(USER_ID, CONNECTION_ID),
    ).resolves.toEqual({ deleted: true });
  });

  it('4. reports last-known status without faking reachability', async () => {
    prisma.tallyConnection.findUnique.mockResolvedValue(connection);
    prisma.companyUser.findUnique.mockResolvedValue(membership('VIEWER'));
    prisma.tallySync.findFirst.mockResolvedValue(null);

    const status = await connections().getStatus(USER_ID, CONNECTION_ID);

    expect(status.status).toBe(TallyConnectionStatus.DISCONNECTED);
    expect(status.reachable).toBeNull();
    expect(status.liveCheck).toMatch('Tally Agent');
  });

  it('5/9. runs the sync lifecycle PENDING → PROCESSING → COMPLETED', async () => {
    prisma.tallyConnection.findUnique.mockResolvedValue(connection);
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    const sync = {
      id: SYNC_ID,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      status: ImportStatus.PENDING,
      tallyCompany: 'Shri Test',
      bankLedger: 'HDFC Bank',
      fromDate: null,
      toDate: null,
    };
    prisma.tallySync.create.mockResolvedValue(sync);
    prisma.tallySync.findUnique.mockResolvedValue(sync);
    prisma.tallyTransaction.findUnique.mockResolvedValue(null);
    prisma.tallyTransaction.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 't-1',
        ...args.data,
      }),
    );
    trackSyncUpdates(prisma, sync);

    const started = await syncs().start(USER_ID, CONNECTION_ID, {
      tallyCompany: 'Shri Test',
      bankLedger: 'HDFC Bank',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    expect(started.status).toBe(ImportStatus.PENDING);

    const result = await syncs().ingest(USER_ID, SYNC_ID, {
      transactions: [txn()],
    });
    expect(result.status).toBe(ImportStatus.COMPLETED);
    expect(result.recordsReceived).toBe(1);
    expect(result.recordsImported).toBe(1);
  });

  it('6/7. normalizes party and keeps decimal amounts exact', async () => {
    prisma.tallyConnection.findUnique.mockResolvedValue(connection);
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    const sync = {
      id: SYNC_ID,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      status: ImportStatus.PROCESSING,
      bankLedger: 'HDFC Bank',
    };
    prisma.tallySync.findUnique.mockResolvedValue(sync);
    prisma.tallyTransaction.findUnique.mockResolvedValue(null);
    prisma.tallyTransaction.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => args.data,
    );
    prisma.tallySync.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        ...sync,
        ...args.data,
      }),
    );

    await syncs().ingest(USER_ID, SYNC_ID, {
      transactions: [txn({ amount: '1,234.56' })],
    });

    const data = prisma.tallyTransaction.create.mock.calls[0][0].data as {
      amount: string;
      party: string;
      normalizedParty?: string;
    };
    expect(data.amount).toBe('1234.56');
    expect(data.party).toBe('ABC Traders Pvt. Ltd.');
    expect(data.normalizedParty).toBe('ABC TRADERS PVT LTD');
  });

  it('8/12. skips duplicate vouchers, fails malformed rows, uses fallback identity', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    const sync = {
      id: SYNC_ID,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      status: ImportStatus.PROCESSING,
      bankLedger: 'HDFC Bank',
    };
    prisma.tallySync.findUnique.mockResolvedValue(sync);
    const seen = new Set<string>();
    prisma.tallyTransaction.findUnique.mockImplementation(
      async (args: {
        where: { companyId_identityHash: { identityHash: string } };
      }) =>
        seen.has(args.where.companyId_identityHash.identityHash)
          ? { id: 'old' }
          : null,
    );
    prisma.tallyTransaction.create.mockImplementation(
      async (args: {
        data: { identityHash: string } & Record<string, unknown>;
      }) => {
        seen.add(args.data.identityHash);
        return args.data;
      },
    );
    trackSyncUpdates(prisma, sync);

    // Same payload twice: identical identityHash → second run skips.
    const svc = syncs();
    const first = await svc.ingest(USER_ID, SYNC_ID, {
      transactions: [txn({ voucherId: undefined, reference: 'R1' })],
    });
    expect(first.recordsImported).toBe(1);
    const created = prisma.tallyTransaction.create.mock.calls[0][0].data as {
      identityHash: string;
      voucherId?: string;
    };
    expect(created.voucherId).toBeUndefined();
    expect(created.identityHash).toMatch(/^[0-9a-f]{64}$/);

    const second = await svc.ingest(USER_ID, SYNC_ID, {
      transactions: [
        txn({ voucherId: undefined, reference: 'R1' }),
        txn({ date: 'not-a-date' }),
      ],
    });
    expect(second.recordsSkipped).toBe(1);
    expect(second.recordsFailed).toBe(1);
    expect(second.status).toBe(ImportStatus.COMPLETED);
  });

  it('10. marks sync FAILED with a clear message when Tally is unavailable', async () => {
    prisma.tallySync.findUnique.mockResolvedValue({
      id: SYNC_ID,
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      status: ImportStatus.PENDING,
    });
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.tallySync.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: SYNC_ID,
        ...args.data,
      }),
    );
    prisma.tallyConnection.update.mockResolvedValue(connection);

    const result = await syncs().fail(
      USER_ID,
      SYNC_ID,
      'Cannot reach TallyPrime — is it running?',
    );

    expect(result.status).toBe(ImportStatus.FAILED);
    expect(prisma.tallyConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TallyConnectionStatus.ERROR,
        }),
      }),
    );
  });
});
