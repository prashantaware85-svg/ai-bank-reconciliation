import {
  TallyError,
  buildCollectionEnvelope,
  buildDayBookEnvelope,
  parseCompanies,
  parseLedgers,
  parseVouchers,
  type RawVoucher,
} from './tally-xml.js';

export interface AgentTransaction {
  voucherId?: string;
  voucherNo?: string;
  /** ISO date string. */
  date: string;
  ledger?: string;
  bankLedger: string;
  voucherType?: string;
  direction: 'DEBIT' | 'CREDIT';
  /** Exact decimal magnitude (string, never float). */
  amount: string;
  reference?: string;
  narration?: string;
  party?: string;
}

export interface VoucherSelection {
  tallyCompany: string;
  bankLedger: string;
  fromDate: string;
  toDate: string;
}

export interface TransactionBatch {
  transactions: AgentTransaction[];
  totalVouchers: number;
  skipped: number;
}

export interface TallyAdapter {
  checkConnection(): Promise<{ ok: boolean; latencyMs: number }>;
  getCompanies(): Promise<string[]>;
  getLedgers(): Promise<string[]>;
  getBankLedgers(): Promise<string[]>;
  getTransactions(sel: VoucherSelection): Promise<TransactionBatch>;
  getVoucherDetails(sel: VoucherSelection): Promise<RawVoucher[]>;
}

const BANK_HINT = /(bank|cash)/i;

function tallyDateToIso(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new TallyError(`Unparseable Tally date "${raw}"`, 'malformed');
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
}

/** Exact absolute decimal from a Tally amount string (no floating point). */
export function absDecimal(raw: string): string | undefined {
  const s = raw.trim().replace(/[, ]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const mag = s.startsWith('-') ? s.slice(1) : s;
  const [int, frac = ''] = mag.split('.') as [string, string];
  const normInt = int.replace(/^0+(?=\d)/, '') || '0';
  if (normInt === '0' && /^0*$/.test(frac)) return '0';
  return frac ? `${normInt}.${frac}` : normInt;
}

/**
 * Map one voucher to a bank-side transaction for the requested ledger.
 * Direction is expressed bank-statement style: money OUT of the bank pedigrees DEBIT.
 * A bank-ledger debit entry (ISDEEMEDPOSITIVE Yes / inflow to the bank) maps
 * to CREDIT; a bank-ledger credit entry maps to DEBIT.
 */
export function toBankTransaction(
  voucher: RawVoucher,
  bankLedger: string,
): { transaction?: AgentTransaction; skipped?: string } {
  const wanted = bankLedger.trim().toLowerCase();
  const entry = voucher.entries.find(
    (e) => e.ledgerName?.trim().toLowerCase() === wanted,
  );
  if (!entry?.ledgerName || !entry.amountRaw) {
    return { skipped: 'bank ledger not in voucher' };
  }
  const magnitude = absDecimal(entry.amountRaw);
  if (!magnitude || magnitude === '0') {
    return { skipped: 'unusable bank amount' };
  }
  if (!voucher.dateRaw) return { skipped: 'missing voucher date' };
  let date: string;
  try {
    date = tallyDateToIso(voucher.dateRaw);
  } catch {
    return { skipped: 'unparseable voucher date' };
  }
  const deemed = entry.isDeemedPositive?.trim().toLowerCase();
  const negative = entry.amountRaw.trim().startsWith('-');
  const isDebitEntry = deemed ? deemed === 'yes' : negative;
  const counter = voucher.entries.find(
    (e) =>
      e.ledgerName &&
      e.ledgerName.trim().toLowerCase() !== wanted,
  );
  // Prefer the counter (non-bank) ledger as the party: in payment/receipt
  // vouchers PARTYLEDGERNAME is often the bank/cash ledger itself.
  const rawParty = voucher.partyLedgerName;
  const party =
    counter?.ledgerName ??
    (rawParty && rawParty.trim().toLowerCase() !== wanted
      ? rawParty
      : undefined);
  return {
    transaction: {
      voucherId: voucher.remoteId ?? voucher.guid,
      voucherNo: voucher.voucherNo,
      date,
      ledger: counter?.ledgerName,
      bankLedger: entry.ledgerName,
      voucherType: voucher.voucherType,
      direction: isDebitEntry ? 'CREDIT' : 'DEBIT',
      amount: magnitude,
      reference: voucher.reference,
      narration: voucher.narration,
      party,
    },
  };
}

async function postXml(
  baseUrl: string,
  xml: string,
  timeoutMs: number,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: xml,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new TallyError('TallyPrime did not respond in time', 'timeout');
    }
    throw new TallyError(
      'Cannot reach TallyPrime — is it running with XML enabled on this port?',
      'unreachable',
    );
  }
  if (!res.ok) {
    throw new TallyError(
      `TallyPrime returned HTTP ${res.status}`,
      'tally',
    );
  }
  return res.text();
}

/** HTTP/XML adapter: the only component that talks to TallyPrime. */
export class HttpTallyAdapter implements TallyAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 20000,
  ) {}

  async checkConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    await postXml(
      this.baseUrl,
      buildCollectionEnvelope('List of Companies'),
      this.timeoutMs,
    );
    return { ok: true, latencyMs: Date.now() - start };
  }

  async getCompanies(): Promise<string[]> {
    return parseCompanies(
      await postXml(
        this.baseUrl,
        buildCollectionEnvelope('List of Companies'),
        this.timeoutMs,
      ),
    );
  }

  async getLedgers(): Promise<string[]> {
    return parseLedgers(
      await postXml(
        this.baseUrl,
        buildCollectionEnvelope('List of Ledgers'),
        this.timeoutMs,
      ),
    );
  }

  async getBankLedgers(): Promise<string[]> {
    return (await this.getLedgers()).filter((l) => BANK_HINT.test(l));
  }

  async getVoucherDetails(sel: VoucherSelection): Promise<RawVoucher[]> {
    return parseVouchers(
      await postXml(
        this.baseUrl,
        buildDayBookEnvelope(sel.fromDate, sel.toDate),
        this.timeoutMs,
      ),
    );
  }

  async getTransactions(sel: VoucherSelection): Promise<TransactionBatch> {
    const vouchers = await this.getVoucherDetails(sel);
    const transactions: AgentTransaction[] = [];
    let skipped = 0;
    for (const v of vouchers) {
      const { transaction, skipped: reason } = toBankTransaction(
        v,
        sel.bankLedger,
      );
      if (transaction) transactions.push(transaction);
      else skipped += 1;
      void reason;
    }
    return { transactions, totalVouchers: vouchers.length, skipped };
  }
}
