import * as XLSX from 'xlsx';
import { XLSX_INR_FMT, formatDate, formatDateTime } from './format.js';

export interface ExportRow {
  bankDate: Date | null;
  bankValueDate: Date | null;
  bankDescription: string | null;
  bankReference: string | null;
  bankDebit: string | null;
  bankCredit: string | null;
  bankAmount: string | null;
  tallyDate: Date | null;
  voucherNo: string | null;
  voucherType: string | null;
  party: string | null;
  ledger: string | null;
  tallyReference: string | null;
  tallyAmount: string | null;
  matchStatus: string;
  matchType: string;
  confidence: number | null;
  reviewStatus: string;
  aiClassification: string | null;
  aiConfidence: string | null;
  risk: string | null;
  reason: string | null;
  reviewer: string | null;
  reviewDate: Date | null;
  reviewComment: string | null;
}

export interface ExportBundle {
  companyName: string;
  rows: ExportRow[];
  aiRows: {
    classification: string;
    aiConfidence: string | null;
    riskLevel: string;
    reason: string;
    recommendedAction: string | null;
    provider: string;
    model: string;
    createdAt: Date;
  }[];
  reviewRows: {
    action: string;
    previousStatus: string;
    newStatus: string;
    comment: string | null;
    createdAt: Date;
    user: { name: string; email: string } | null;
  }[];
  summary: Record<string, string | number>;
  filters: Record<string, string | undefined>;
  footer: string[];
}

const HEADER = [
  'Bank Date',
  'Bank Value Date',
  'Bank Description',
  'Bank Reference',
  'Bank Debit',
  'Bank Credit',
  'Bank Amount',
  'Tally Date',
  'Voucher No',
  'Voucher Type',
  'Party',
  'Ledger',
  'Tally Reference',
  'Tally Amount',
  'Match Status',
  'Match Type',
  'Confidence',
  'Review Status',
  'AI Classification',
  'AI Confidence',
  'Risk',
  'Reason',
  'Reviewer',
  'Review Date',
  'Review Comment',
];

const CURRENCY_COLS = new Set([
  'Bank Debit',
  'Bank Credit',
  'Bank Amount',
  'Tally Amount',
]);
const DATE_COLS = new Set(['Bank Date', 'Bank Value Date', 'Tally Date', 'Review Date']);

function sheetFrom(
  header: string[],
  rows: (string | number | null)[][],
  widths: number[],
  currencyCols: Set<string> = new Set(),
  dateCols: Set<string> = new Set(),
): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  // Currency/date number formats + freeze header row.
  for (let r = 1; r <= rows.length; r += 1) {
    header.forEach((h, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) return;
      if (currencyCols.has(h) && typeof cell.v === 'string') {
        const num = Number(cell.v.replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(num)) {
          cell.v = num;
          cell.t = 'n';
        }
        cell.z = XLSX_INR_FMT;
      } else if (dateCols.has(h) && cell.v) {
        cell.z = 'yyyy-mm-dd';
      }
    });
  }
  return ws;
}

/**
 * Accountant-friendly workbook: Summary / Reconciliation / Exceptions /
 * Review History / AI Analysis. Row-capped; never includes secrets.
 */
export function buildWorkbook(bundle: ExportBundle): Buffer {
  const summaryRows: (string | number | null)[][] = [
    ['Report', 'Reconciliation Summary'],
    ['Company', bundle.companyName],
    ['Generated At', formatDateTime(new Date())],
    ...Object.entries(bundle.filters)
      .filter(([, v]) => v)
      .map(([k, v]) => [`Filter: ${k}`, String(v)]),
    [''],
    ...Object.entries(bundle.summary).map(([k, v]) => [
      k,
      typeof v === 'number' ? v : String(v),
    ]),
    [''],
    ...bundle.footer.map((line) => [line]),
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary['!cols'] = [{ wch: 34 }, { wch: 44 }];

  const reconRows = bundle.rows.map((r) => [
    formatDate(r.bankDate),
    formatDate(r.bankValueDate),
    r.bankDescription,
    r.bankReference,
    r.bankDebit,
    r.bankCredit,
    r.bankAmount,
    formatDate(r.tallyDate),
    r.voucherNo,
    r.voucherType,
    r.party,
    r.ledger,
    r.tallyReference,
    r.tallyAmount,
    r.matchStatus,
    r.matchType,
    r.confidence,
    r.reviewStatus,
    r.aiClassification,
    r.aiConfidence ? String(r.aiConfidence) : null,
    r.risk,
    r.reason,
    r.reviewer,
    formatDate(r.reviewDate),
    r.reviewComment,
  ]);
  const reconciliation = sheetFrom(
    HEADER,
    reconRows,
    [12, 12, 34, 16, 12, 12, 14, 12, 14, 12, 24, 24, 16, 14, 16, 12, 10, 18, 20, 10, 8, 40, 16, 12, 30],
    CURRENCY_COLS,
    DATE_COLS,
  );

  const EXCEPTION_STATUSES = new Set([
    'POSSIBLE_MATCH',
    'UNMATCHED',
    'AMOUNT_MISMATCH',
    'DATE_MISMATCH',
    'REVIEW_REQUIRED',
    'MISSING_IN_TALLY',
    'MISSING_IN_BANK',
  ]);
  const exceptionRows = reconRows.filter((row) =>
    EXCEPTION_STATUSES.has(String(row[14])),
  );
  const exceptions = sheetFrom(
    HEADER,
    exceptionRows,
    [12, 12, 34, 16, 12, 12, 14, 12, 14, 12, 24, 24, 16, 14, 16, 12, 10, 18, 20, 10, 8, 40, 16, 12, 30],
    CURRENCY_COLS,
    DATE_COLS,
  );

  const historyHeader = ['Date/Time', 'User', 'Action', 'Previous Status', 'New Status', 'Comment'];
  const historyRows = bundle.reviewRows.map((r) => [
    formatDateTime(r.createdAt),
    r.user?.name ?? 'Unknown',
    r.action,
    r.previousStatus,
    r.newStatus,
    r.comment,
  ]);
  const reviewHistory = sheetFrom(
    historyHeader,
    historyRows,
    [18, 20, 24, 24, 26, 44],
  );

  const aiHeader = ['Generated At', 'Provider', 'Model', 'Classification', 'AI Confidence', 'Risk', 'Reason', 'Recommended Action'];
  const aiDataRows = bundle.aiRows.map((r) => [
    formatDateTime(r.createdAt),
    r.provider,
    r.model,
    r.classification,
    r.aiConfidence ? String(r.aiConfidence) : null,
    r.riskLevel,
    r.reason,
    r.recommendedAction,
  ]);
  const aiAnalysis = sheetFrom(aiHeader, aiDataRows, [18, 20, 16, 24, 12, 8, 50, 34]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summary, 'Summary');
  XLSX.utils.book_append_sheet(wb, reconciliation, 'Reconciliation');
  XLSX.utils.book_append_sheet(wb, exceptions, 'Exceptions');
  XLSX.utils.book_append_sheet(wb, reviewHistory, 'Review History');
  XLSX.utils.book_append_sheet(wb, aiAnalysis, 'AI Analysis');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Exceptions-only workbook (same formatting). */
export function buildExceptionsWorkbook(bundle: ExportBundle): Buffer {
  return buildWorkbook({
    ...bundle,
    rows: bundle.rows.filter((r) =>
      [
        'POSSIBLE_MATCH',
        'UNMATCHED',
        'AMOUNT_MISMATCH',
        'DATE_MISMATCH',
        'REVIEW_REQUIRED',
        'MISSING_IN_TALLY',
        'MISSING_IN_BANK',
      ].includes(r.matchStatus),
    ),
  });
}
