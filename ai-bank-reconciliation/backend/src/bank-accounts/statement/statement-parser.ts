import { Decimal } from 'decimal.js';
import * as XLSX from 'xlsx';
import {
  detectMapping,
  mappingGaps,
  type CanonicalField,
  type ColumnMapping,
} from './column-map.js';
import { cellText, normalizeText } from './normalize.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

export type FileType = 'XLSX' | 'XLS' | 'CSV';

/** JSON-compatible row object (xlsx Dates are stringified to ISO on intake). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export interface PreviewResult {
  fileName: string;
  fileType: FileType;
  fileSizeBytes: number;
  totalRows: number;
  detectedColumns: string[];
  mapping: ColumnMapping | null;
  unmappedColumns: string[];
  warnings: string[];
  errors: string[];
  previewRows: Record<string, JsonValue | undefined>[];
}

export interface ParsedRow {
  rowIndex: number;
  status: 'ok' | 'skipped' | 'failed';
  message?: string;
  originalRow: { [key: string]: JsonValue | undefined };
  transactionDate?: Date;
  valueDate?: Date | null;
  description?: string;
  narration?: string;
  chequeNumber?: string;
  reference?: string;
  debit?: string | null;
  credit?: string | null;
  amount?: string;
  direction?: 'DEBIT' | 'CREDIT';
  balance?: string | null;
  normalizedNarration?: string;
  normalizedReference?: string;
}

export interface ImportOutcome {
  rows: ParsedRow[];
  imported: number;
  skipped: number;
  failed: number;
  warnings: string[];
  rowErrors: { rowIndex: number; message: string }[];
  dateRange: { min: string; max: string } | null;
  totalDebit: string;
  totalCredit: string;
}

const KNOWN_FIELDS = new Set<string>([
  'transactionDate',
  'valueDate',
  'description',
  'narration',
  'chequeNumber',
  'reference',
  'debit',
  'credit',
  'amount',
  'balance',
]);

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i).toLowerCase() : '';
}

export function fileTypeOf(fileName: string): FileType | null {
  switch (extensionOf(fileName)) {
    case '.xlsx':
      return 'XLSX';
    case '.xls':
      return 'XLS';
    case '.csv':
      return 'CSV';
    default:
      return null;
  }
}

function assertSupported(fileName: string): FileType {
  const type = fileTypeOf(fileName);
  if (!type) {
    throw new Error(
      `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }
  return type;
}

/** Parse a workbook/CSV buffer into header + row objects. Never executes content. */
export function parseWorkbook(
  buffer: Buffer,
  fileName: string,
): { headers: string[]; rows: Record<string, unknown>[] } {
  assertSupported(fileName);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new Error('File is corrupted or unreadable');
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('File is corrupted or unreadable');
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  }) as unknown[][];
  if (grid.length === 0) throw new Error('File is empty');
  const headers = (grid[0] ?? []).map((h) => cellText(h)?.trim() ?? '');
  if (!headers.some((h) => h)) {
    throw new Error('File has no usable header row');
  }
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < grid.length; i += 1) {
    const cells = grid[i] ?? [];
    if (cells.every((c) => c === null || c === undefined || c === '')) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cells[idx] ?? null;
    });
    rows.push(row);
  }
  if (rows.length === 0) throw new Error('File has no usable rows');
  return { headers: headers.filter(Boolean), rows };
}

export function parseDateValue(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) {
    return isSaneDate(value) ? value : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return isSaneDate(d) ? d : undefined;
  }
  const s = cellText(value)?.trim();
  if (!s) return undefined;
  let d: Date | undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    d = new Date(s);
  } else {
    const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s|$)/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      d = new Date(Date.UTC(year, month - 1, day));
    } else {
      d = new Date(s);
    }
  }
  return d && isSaneDate(d) ? d : undefined;
}

function isSaneDate(d: Date): boolean {
  return (
    !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1990 && d.getUTCFullYear() <= 2100
  );
}

export interface DecimalParse {
  empty: boolean;
  valid: boolean;
  /** Normalized decimal string (never a JS float). */
  value?: string;
}

/** Parse money text into an exact decimal string using decimal.js only. */
export function parseDecimal(value: unknown): DecimalParse {
  if (value === null || value === undefined) return { empty: true, valid: true };
  const raw = cellText(value)?.trim();
  if (!raw) return { empty: true, valid: true };
  let s = raw;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/^(Rs\.?|INR|₹)\s*/i, '')
    .replace(/[,₹$\s]/g, '')
    .trim();
  if (!s || s === '-' || s === '.') return { empty: true, valid: true };
  try {
    let d = new Decimal(s);
    if (negative) d = d.neg();
    if (!d.isFinite()) return { empty: false, valid: false };
    return { empty: false, valid: true, value: d.toString() };
  } catch {
    return { empty: false, valid: false };
  }
}

const asText = (value: unknown): string | undefined => {
  const s = cellText(value)?.trim();
  return s ? s : undefined;
};

function jsonSafe(
  row: Record<string, unknown>,
): { [key: string]: JsonValue | undefined } {
  return JSON.parse(JSON.stringify(row)) as {
    [key: string]: JsonValue | undefined;
  };
}

function cell(row: Record<string, unknown>, mapping: ColumnMapping, field: CanonicalField): unknown {
  const col = mapping[field];
  return col ? row[col] : undefined;
}

/** Validate a user-supplied mapping against detected columns. */
export function validateMapping(
  mapping: unknown,
  detectedColumns: string[],
): { mapping: ColumnMapping; errors: string[] } {
  const errors: string[] = [];
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return { mapping: {}, errors: ['Mapping must be an object'] };
  }
  const out: ColumnMapping = {};
  for (const [field, col] of Object.entries(mapping as Record<string, unknown>)) {
    if (!KNOWN_FIELDS.has(field)) {
      errors.push(`Unknown field "${field}"`);
      continue;
    }
    if (typeof col !== 'string' || !detectedColumns.includes(col)) {
      errors.push(`Field "${field}" must map to a detected column`);
      continue;
    }
    out[field as CanonicalField] = col;
  }
  for (const gap of mappingGaps(out)) {
    errors.push(`Missing required mapping: ${gap}`);
  }
  return { mapping: out, errors };
}

/** Build a preview without writing anything to the database. */
export function buildPreview(
  buffer: Buffer,
  fileName: string,
): PreviewResult {
  const fileType = assertSupported(fileName);
  const { headers, rows } = parseWorkbook(buffer, fileName);
  const { mapping, unmappedColumns, warnings } = detectMapping(headers);
  const gaps = mappingGaps(mapping);
  const errors =
    gaps.length > 0
      ? [
          `Cannot map required columns: ${gaps.join('; ')}. Correct the mapping to continue.`,
        ]
      : [];
  return {
    fileName,
    fileType,
    fileSizeBytes: buffer.length,
    totalRows: rows.length,
    detectedColumns: headers,
    mapping: gaps.length > 0 ? null : mapping,
    unmappedColumns,
    warnings,
    errors,
    previewRows: rows.slice(0, 20).map(jsonSafe),
  };
}

/** Apply a confirmed mapping to parsed rows (pure; no I/O). */
export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
): ImportOutcome {
  const parsed: ParsedRow[] = [];
  const warnings: string[] = [];
  const rowErrors: { rowIndex: number; message: string }[] = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const okTimes: number[] = [];

  rows.forEach((raw, i) => {
    const rowIndex = i + 2; // 1-based incl. header
    const fail = (message: string): ParsedRow => {
      failed += 1;
      rowErrors.push({ rowIndex, message });
      return { rowIndex, status: 'failed', message, originalRow: jsonSafe(raw) };
    };

    const date = parseDateValue(cell(raw, mapping, 'transactionDate'));
    if (!date) {
      parsed.push(fail('Unparseable or missing transaction date'));
      return;
    }

    const debit = parseDecimal(cell(raw, mapping, 'debit'));
    const credit = parseDecimal(cell(raw, mapping, 'credit'));
    const amountCol = parseDecimal(cell(raw, mapping, 'amount'));
    if (!debit.valid || !credit.valid || !amountCol.valid) {
      parsed.push(fail('Unparseable debit/credit/amount value'));
      return;
    }

    const d = !debit.empty ? new Decimal(debit.value as string) : null;
    const c = !credit.empty ? new Decimal(credit.value as string) : null;
    const dPos = d && !d.isZero() ? d : null;
    const cPos = c && !c.isZero() ? c : null;

    let amount: Decimal;
    let direction: 'DEBIT' | 'CREDIT';
    if (dPos && cPos) {
      parsed.push(fail('Both debit and credit are populated'));
      return;
    } else if (dPos) {
      amount = dPos;
      direction = 'DEBIT';
    } else if (cPos) {
      amount = cPos;
      direction = 'CREDIT';
    } else if (!amountCol.empty) {
      const a = new Decimal(amountCol.value as string);
      if (a.isZero()) {
        skipped += 1;
        parsed.push({
          rowIndex,
          status: 'skipped',
          message: 'Zero amount',
          originalRow: jsonSafe(raw),
        });
        return;
      }
      amount = a.abs();
      direction = a.isNegative() ? 'DEBIT' : 'CREDIT';
    } else {
      parsed.push(fail('No usable debit, credit, or amount'));
      return;
    }

    const balance = parseDecimal(cell(raw, mapping, 'balance'));
    if (!balance.valid) warnings.push(`Row ${rowIndex}: unparseable balance ignored`);

    const narration = asText(cell(raw, mapping, 'narration'));
    const reference = asText(cell(raw, mapping, 'reference'));
    const chequeNumber = asText(cell(raw, mapping, 'chequeNumber'));

    okTimes.push(date.getTime());
    if (direction === 'DEBIT') totalDebit = totalDebit.plus(amount);
    else totalCredit = totalCredit.plus(amount);
    imported += 1;

    parsed.push({
      rowIndex,
      status: 'ok',
      originalRow: jsonSafe(raw),
      transactionDate: date,
      valueDate: parseDateValue(cell(raw, mapping, 'valueDate')) ?? null,
      description: asText(cell(raw, mapping, 'description')),
      narration,
      chequeNumber,
      reference,
      debit: d ? d.toString() : null,
      credit: c ? c.toString() : null,
      amount: amount.toString(),
      direction,
      balance: balance.valid && !balance.empty ? (balance.value as string) : null,
      normalizedNarration: normalizeText(narration),
      normalizedReference: normalizeText(reference),
    });
  });

  let minTime: number | null = null;
  let maxTime: number | null = null;
  for (const t of okTimes) {
    if (minTime === null || t < minTime) minTime = t;
    if (maxTime === null || t > maxTime) maxTime = t;
  }

  return {
    rows: parsed,
    imported,
    skipped,
    failed,
    warnings,
    rowErrors: rowErrors.slice(0, 100),
    dateRange:
      minTime !== null && maxTime !== null
        ? {
            min: new Date(minTime).toISOString(),
            max: new Date(maxTime).toISOString(),
          }
        : null,
    totalDebit: totalDebit.toString(),
    totalCredit: totalCredit.toString(),
  };
}
