import { describe, expect, it } from 'vitest';
import {
  absDecimal,
  toBankTransaction,
} from '../src/adapter.js';
import { normalizeText } from '../src/normalize.js';
import {
  TallyError,
  buildCollectionEnvelope,
  buildDayBookEnvelope,
  parseCompanies,
  parseLedgers,
  parseVouchers,
  toTallyDate,
} from '../src/tally-xml.js';

// Synthetic fixtures only — never real Tally data.
const COMPANIES_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION><COMPANY NAME="Synthetic Traders" RESERVEDNAME=""></COMPANY><COMPANY NAME="Demo Foods" RESERVEDNAME=""></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>`;

const LEDGERS_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION><LEDGER NAME="HDFC Bank" RESERVEDNAME=""></LEDGER><LEDGER NAME="Cash" RESERVEDNAME=""></LEDGER><LEDGER NAME="Sales" RESERVEDNAME=""></LEDGER></COLLECTION></DATA></BODY></ENVELOPE>`;

const DAYBOOK_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER REMOTEID="remote-1" VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
<GUID>remote-1</GUID><DATE>20260905</DATE><VOUCHERNUMBER>12</VOUCHERNUMBER>
<NARRATION>Paid supplier</NARRATION><REFERENCE>UTR-1</REFERENCE><PARTYLEDGERNAME>Synthetic Supplier</PARTYLEDGERNAME>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Synthetic Supplier</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-5000</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>5000</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>
<VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
<GUID>guid-no-remote</GUID><DATE>20260906</DATE><VOUCHERNUMBER>13</VOUCHERNUMBER>
<NARRATION>Collection</NARRATION>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1250.75</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1250.75</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></DATA></BODY></ENVELOPE>`;

describe('tally-xml', () => {
  it('builds official Export envelopes', () => {
    const c = buildCollectionEnvelope('List of Companies');
    expect(c).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    expect(c).toContain('$$SysName:XML');
    const d = buildDayBookEnvelope('2026-09-01', '2026-09-30');
    expect(d).toContain('<SVFROMDATE>20260901</SVFROMDATE>');
    expect(d).toContain('<SVTODATE>20260930</SVTODATE>');
    expect(toTallyDate('2026-09-01T00:00:00.000Z')).toBe('20260901');
  });

  it('parses company and ledger collections', () => {
    expect(parseCompanies(COMPANIES_XML)).toEqual([
      'Synthetic Traders',
      'Demo Foods',
    ]);
    expect(parseLedgers(LEDGERS_XML)).toContain('HDFC Bank');
  });

  it('parses Day Book vouchers with entries', () => {
    const vouchers = parseVouchers(DAYBOOK_XML);
    expect(vouchers).toHaveLength(2);
    expect(vouchers[0]?.remoteId).toBe('remote-1');
    expect(vouchers[0]?.entries).toHaveLength(2);
    expect(vouchers[1]?.remoteId).toBeUndefined();
    expect(vouchers[1]?.guid).toBe('guid-no-remote');
  });

  it('handles repeated TALLYMESSAGE blocks (array shape)', () => {
    const inner = DAYBOOK_XML.match(
      /<TALLYMESSAGE[^>]*>([\s\S]*)<\/TALLYMESSAGE>/,
    )?.[1];
    const doubled = `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><TALLYMESSAGE>${inner}</TALLYMESSAGE><TALLYMESSAGE>${inner}</TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
    expect(parseVouchers(doubled)).toHaveLength(4);
  });

  it('rejects malformed responses', () => {
    expect(() => parseCompanies('<broken')).toThrow(TallyError);
    expect(() => parseVouchers('<ENVELOPE></ENVELOPE>')).toThrow(TallyError);
  });
});

describe('adapter mapping', () => {
  it('maps bank-credit entries to DEBIT with exact amounts', () => {
    const [v] = parseVouchers(DAYBOOK_XML);
    const { transaction } = toBankTransaction(v!, 'HDFC Bank');
    expect(transaction?.direction).toBe('DEBIT');
    expect(transaction?.amount).toBe('5000');
    expect(transaction?.voucherId).toBe('remote-1');
    expect(transaction?.party).toBe('Synthetic Supplier');
  });

  it('maps bank-debit entries to CREDIT and falls back to GUID', () => {
    const [, v] = parseVouchers(DAYBOOK_XML);
    const { transaction } = toBankTransaction(v!, 'HDFC Bank');
    expect(transaction?.direction).toBe('CREDIT');
    expect(transaction?.amount).toBe('1250.75');
    expect(transaction?.voucherId).toBe('guid-no-remote');
  });

  it('prefers the counter ledger as party over a bank PARTYLEDGERNAME', () => {
    const [v] = parseVouchers(DAYBOOK_XML);
    const withBankParty = {
      ...v!,
      partyLedgerName: 'HDFC Bank',
      entries: v!.entries,
    };
    const { transaction } = toBankTransaction(withBankParty, 'HDFC Bank');
    expect(transaction?.party).toBe('Synthetic Supplier');
    expect(transaction?.ledger).toBe('Synthetic Supplier');
  });

  it('skips vouchers without the bank ledger', () => {
    const [v] = parseVouchers(DAYBOOK_XML);
    const { transaction, skipped } = toBankTransaction(v!, 'Missing Bank');
    expect(transaction).toBeUndefined();
    expect(skipped).toBeTruthy();
  });

  it('handles decimal magnitudes exactly', () => {
    expect(absDecimal('-1250.75')).toBe('1250.75');
    expect(absDecimal('1,000')).toBe('1000');
    expect(absDecimal('abc')).toBeUndefined();
    expect(normalizeText('ABC Traders Pvt. Ltd.')).toBe('ABC TRADERS PVT LTD');
  });
});
