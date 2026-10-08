import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyRole, ImportStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { BankImportsService } from './bank-imports.service.js';
import { detectMapping } from './statement/column-map.js';
import {
  parseDateValue,
  parseDecimal,
} from './statement/statement-parser.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const account = {
  id: ACCOUNT_ID,
  companyId: COMPANY_ID,
  bankName: 'HDFC Bank',
  accountName: 'Current A/c',
};

const ownerMembership = {
  id: 'm-1',
  userId: USER_ID,
  companyId: COMPANY_ID,
  role: CompanyRole.OWNER,
};

function xlsxBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Statement');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const HEADERS = [
  'Txn Date',
  'Value Date',
  'Narration',
  'Cheque No',
  'Ref No',
  'Withdrawal',
  'Deposit',
  'Balance',
];

function sampleRows(): unknown[][] {
  return [
    HEADERS,
    ['01/04/2026', '01/04/2026', 'NEFT  ABC Traders Pvt. Ltd.', '', 'UTR123', 5000, '', 15000],
    ['02/04/2026', '02/04/2026', 'UPI Payment received', '', 'UPI456', '', '1,234.56', 16234.56],
  ];
}

function fileOf(buffer: Buffer, name: string) {
  return {
    originalname: name,
    buffer,
    size: buffer.length,
    mimetype: 'application/octet-stream',
  } as Express.Multer.File;
}

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn() },
    bankImport: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    bankTransaction: { createMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

describe('statement import', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
    prisma.companyUser.findUnique.mockResolvedValue(ownerMembership);
    prisma.bankAccount.findUnique.mockResolvedValue(account);
    prisma.bankImport.findFirst.mockResolvedValue(null);
    prisma.bankImport.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'import-1',
        ...args.data,
      }),
    );
    prisma.bankImport.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'import-1',
        ...args.data,
      }),
    );
    prisma.bankTransaction.createMany.mockResolvedValue({ count: 2 });
  });

  const service = () =>
    new BankImportsService(prisma as unknown as PrismaService);

  it('8. imports a valid XLSX file', async () => {
    const buf = xlsxBuffer(sampleRows());
    const preview = await service().preview(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
    );
    expect(preview.totalRows).toBe(2);
    expect(preview.errors).toHaveLength(0);

    const result = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      {},
    );
    expect(result.status).toBe(ImportStatus.COMPLETED);
    expect(result.summary.imported).toBe(2);
    expect(prisma.bankTransaction.createMany).toHaveBeenCalled();
  });

  it('9. imports a valid CSV file', async () => {
    const csv = Buffer.from(
      'Date,Narration,Debit,Credit\n01/04/2026,NEFT X,5000,\n02/04/2026,UPI Y,,250.75\n',
    );
    const result = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(csv, 'stmt.csv'),
      {},
    );
    expect(result.status).toBe(ImportStatus.COMPLETED);
    expect(result.summary.imported).toBe(2);
  });

  it('10. rejects an invalid (corrupted) file', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    await expect(
      service().preview(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx')),
    ).rejects.toThrow();
  });

  it('11. rejects an empty file', async () => {
    await expect(
      service().preview(
        USER_ID,
        ACCOUNT_ID,
        fileOf(Buffer.alloc(0), 'stmt.csv'),
      ),
    ).rejects.toThrow('empty');
    const wrongExt = fileOf(Buffer.from('a,b\n1,2\n'), 'stmt.pdf');
    await expect(
      service().preview(USER_ID, ACCOUNT_ID, wrongExt),
    ).rejects.toThrow('Unsupported file type');
  });

  it('12. rejects files with missing required columns', async () => {
    const buf = xlsxBuffer([['Narration', 'Balance'], ['hello', 100]]);
    const preview = await service().preview(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
    );
    expect(preview.mapping).toBeNull();
    expect(preview.errors.length).toBeGreaterThan(0);

    await expect(
      service().confirm(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx'), {}),
    ).rejects.toThrow('Missing required mapping');
  });

  it('13. detects columns automatically from bank aliases', async () => {
    const buf = xlsxBuffer(sampleRows());
    const preview = await service().preview(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
    );
    expect(preview.mapping).toMatchObject({
      transactionDate: 'Txn Date',
      narration: 'Narration',
      debit: 'Withdrawal',
      credit: 'Deposit',
    });
  });

  it('14. accepts a manual column mapping', async () => {
    const buf = xlsxBuffer([
      ['A', 'B', 'C'],
      ['2026-04-01', 100, ''],
    ]);
    const result = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      { mapping: { transactionDate: 'A', debit: 'B', credit: 'C' } },
    );
    expect(result.summary.imported).toBe(1);

    await expect(
      service().confirm(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx'), {
        mapping: { bogus: 'A' } as never,
      }),
    ).rejects.toThrow();
  });

  it('15. parses debit transactions (amount + DEBIT)', async () => {
    const buf = xlsxBuffer(sampleRows());
    await service().confirm(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx'), {});
    const data = prisma.bankTransaction.createMany.mock.calls[0][0].data as {
      amount: string;
      direction: string;
    }[];
    const debitRow = data.find((r) => r.direction === 'DEBIT');
    expect(debitRow?.amount).toBe('5000');
  });

  it('16. parses credit transactions and flags dual-populated rows', async () => {
    const buf = xlsxBuffer([
      ['Date', 'Narration', 'Debit', 'Credit'],
      ['01/04/2026', 'ok credit', '', 250],
      ['02/04/2026', 'both sides', 100, 100],
    ]);
    const result = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      {},
    );
    expect(result.summary.imported).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.rowErrors[0].message).toMatch('Both debit and credit');
    const data = prisma.bankTransaction.createMany.mock.calls[0][0].data as {
      direction: string;
    }[];
    expect(data[0].direction).toBe('CREDIT');
  });

  it('17. handles decimal amounts exactly (no float error)', async () => {
    expect(parseDecimal('1,234.56')).toEqual({
      empty: false,
      valid: true,
      value: '1234.56',
    });
    expect(parseDecimal('0.1')).toMatchObject({ value: '0.1' });
    const buf = xlsxBuffer(sampleRows());
    const result = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      {},
    );
    expect(result.summary.totalCredit).toBe('1234.56');
  });

  it('18. preserves the original row verbatim', async () => {
    const buf = xlsxBuffer(sampleRows());
    await service().confirm(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx'), {});
    const data = prisma.bankTransaction.createMany.mock.calls[0][0].data as {
      originalRow: Record<string, unknown>;
      narration: string;
    }[];
    expect(data[0].originalRow['Narration']).toBe('NEFT  ABC Traders Pvt. Ltd.');
    expect(data[0].narration).toBe('NEFT  ABC Traders Pvt. Ltd.');
  });

  it('19. normalizes narration without destroying the original', async () => {
    const buf = xlsxBuffer(sampleRows());
    const preview = await service().preview(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
    );
    expect(preview.previewRows[0]['Narration']).toBe(
      'NEFT  ABC Traders Pvt. Ltd.',
    );
    await service().confirm(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx'), {});
    const data = prisma.bankTransaction.createMany.mock.calls[0][0].data as {
      normalizedNarration?: string;
    }[];
    expect(data[0].normalizedNarration).toBe('NEFT ABC TRADERS PVT LTD');
  });

  it('20. normalizes references', async () => {
    const { applyMapping } = await import(
      './statement/statement-parser.js'
    );
    const outcome = applyMapping(
      [
        {
          Date: '01/04/2026',
          'Ref No': ' utr-123/abc ',
          Debit: 10,
        },
      ],
      { transactionDate: 'Date', reference: 'Ref No', debit: 'Debit' },
    );
    expect(outcome.rows[0].reference).toBe('utr-123/abc');
    expect(outcome.rows[0].normalizedReference).toBe('UTR123ABC');
  });

  it('21. returns a full import summary', async () => {
    const buf = xlsxBuffer(sampleRows());
    const result = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      {},
    );
    expect(result.summary).toMatchObject({
      totalRows: 2,
      imported: 2,
      skipped: 0,
      failed: 0,
      totalDebit: '5000',
      totalCredit: '1234.56',
    });
    expect(result.summary.dateRange).toBeTruthy();
  });

  it('22. detects possible duplicate imports and requires confirmation', async () => {
    const buf = xlsxBuffer(sampleRows());
    const first = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      {},
    );
    expect(first.status).toBe(ImportStatus.COMPLETED);

    prisma.bankImport.findFirst.mockResolvedValue({
      id: 'import-1',
      totalRows: 2,
      createdAt: new Date(),
    });
    await expect(
      service().confirm(USER_ID, ACCOUNT_ID, fileOf(buf, 'stmt.xlsx'), {}),
    ).rejects.toThrow('Possible duplicate');

    const retry = await service().confirm(
      USER_ID,
      ACCOUNT_ID,
      fileOf(buf, 'stmt.xlsx'),
      { allowDuplicate: true },
    );
    expect(retry.status).toBe(ImportStatus.COMPLETED);
  });

  it('parses common date formats and alias headers', async () => {
    expect(parseDateValue('01/04/2026')?.toISOString()).toBe(
      new Date(Date.UTC(2026, 3, 1)).toISOString(),
    );
    expect(parseDateValue('2026-04-01')?.toISOString()).toBe(
      new Date('2026-04-01').toISOString(),
    );
    const { mapping } = detectMapping(['Txn Date', 'UTR', 'Balance']);
    expect(mapping).toMatchObject({
      transactionDate: 'Txn Date',
      reference: 'UTR',
      balance: 'Balance',
    });
  });
});
