import { normalizeHeader } from './normalize.js';

export type CanonicalField =
  | 'transactionDate'
  | 'valueDate'
  | 'description'
  | 'narration'
  | 'chequeNumber'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance';

export type ColumnMapping = Partial<Record<CanonicalField, string>>;

/** Normalized header alias → canonical field. */
const ALIASES: Record<string, CanonicalField> = {
  date: 'transactionDate',
  transactiondate: 'transactionDate',
  txndate: 'transactionDate',
  trandate: 'transactionDate',
  transdate: 'transactionDate',
  postingdate: 'transactionDate',
  valuedate: 'valueDate',
  valuedt: 'valueDate',
  valdate: 'valueDate',
  description: 'description',
  transactiondetails: 'description',
  transactiondescription: 'description',
  particulars: 'description',
  details: 'description',
  narration: 'narration',
  remarks: 'narration',
  remark: 'narration',
  chequenumber: 'chequeNumber',
  chequeno: 'chequeNumber',
  chqno: 'chequeNumber',
  chq: 'chequeNumber',
  instrumentno: 'chequeNumber',
  instrumentnumber: 'chequeNumber',
  reference: 'reference',
  refno: 'reference',
  ref: 'reference',
  referenceno: 'reference',
  referencenumber: 'reference',
  utr: 'reference',
  utrno: 'reference',
  transactionid: 'reference',
  txnid: 'reference',
  transactionno: 'reference',
  transactionnumber: 'reference',
  debit: 'debit',
  debitamount: 'debit',
  withdrawal: 'debit',
  withdrawals: 'debit',
  dr: 'debit',
  paidout: 'debit',
  debitamt: 'debit',
  credit: 'credit',
  creditamount: 'credit',
  deposit: 'credit',
  deposits: 'credit',
  cr: 'credit',
  received: 'credit',
  paidin: 'credit',
  creditamt: 'credit',
  amount: 'amount',
  transactionamount: 'amount',
  txnamount: 'amount',
  balance: 'balance',
  closingbalance: 'balance',
  availablebalance: 'balance',
  runningbalance: 'balance',
};

export const REQUIRED_NOTE =
  'transaction date plus at least one of debit, credit, amount';

/**
 * Auto-detect column mapping from raw header cells.
 * First header wins per field; collisions become warnings.
 */
export function detectMapping(headers: string[]): {
  mapping: ColumnMapping;
  unmappedColumns: string[];
  warnings: string[];
} {
  const mapping: ColumnMapping = {};
  const claimedBy: Record<string, CanonicalField> = {};
  const warnings: string[] = [];
  const unmappedColumns: string[] = [];

  for (const header of headers) {
    const label = header.trim();
    if (!label) continue;
    const field = ALIASES[normalizeHeader(label)];
    if (!field) {
      unmappedColumns.push(label);
      continue;
    }
    if (claimedBy[label] !== undefined || mapping[field] !== undefined) {
      warnings.push(
        `Column "${label}" also matches "${field}" but "${mapping[field]}" was kept`,
      );
      unmappedColumns.push(label);
      continue;
    }
    claimedBy[label] = field;
    mapping[field] = label;
  }

  return { mapping, unmappedColumns, warnings };
}

/** Minimum viable mapping: transaction date + debit/credit/amount. */
export function mappingGaps(mapping: ColumnMapping): string[] {
  const gaps: string[] = [];
  if (!mapping.transactionDate) gaps.push('transaction date');
  if (!mapping.debit && !mapping.credit && !mapping.amount) {
    gaps.push('at least one of debit, credit, amount');
  }
  return gaps;
}
