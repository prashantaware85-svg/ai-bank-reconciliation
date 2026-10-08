import { XMLParser } from 'fast-xml-parser';

/**
 * Official TallyPrime HTTP/XML integration (per TallyHelp "Integration With
 * TallyPrime" + developer.tallysolutions.com Data Exchange docs):
 * POST text/xml to http://<host>:<port>/ (default 9000, TallyPrime running,
 * company loaded), TALLYREQUEST Export, SVEXPORTFORMAT $$SysName:XML.
 * Verified live against TallyPrime on this machine (HTTP 200 + vouchers).
 */

export function toTallyDate(date: string): string {
  const day = date.slice(0, 10);
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Date must be YYYY-MM-DD (got "${date}")`);
  return `${m[1]}${m[2]}${m[3]}`;
}

export function buildCollectionEnvelope(collectionId: string): string {
  return (
    `<ENVELOPE><HEADER><VERSION>1</VERSION>` +
    `<TALLYREQUEST>Export</TALLYREQUEST>` +
    `<TYPE>Collection</TYPE><ID>${collectionId}</ID></HEADER>` +
    `<BODY><DESC><STATICVARIABLES>` +
    `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
    `</STATICVARIABLES></DESC></BODY></ENVELOPE>`
  );
}

export function buildDayBookEnvelope(fromDate: string, toDate: string): string {
  return (
    `<ENVELOPE><HEADER><VERSION>1</VERSION>` +
    `<TALLYREQUEST>Export</TALLYREQUEST>` +
    `<TYPE>Data</TYPE><ID>DayBook</ID></HEADER>` +
    `<BODY><DESC><STATICVARIABLES>` +
    `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
    `<SVFROMDATE>${toTallyDate(fromDate)}</SVFROMDATE>` +
    `<SVTODATE>${toTallyDate(toDate)}</SVTODATE>` +
    `</STATICVARIABLES></DESC></BODY></ENVELOPE>`
  );
}

export class TallyError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'unreachable'
      | 'timeout'
      | 'malformed'
      | 'tally',
  ) {
    super(message);
    this.name = 'TallyError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

function envelopeBody(xml: string): Record<string, unknown> {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new TallyError(
      'Tally returned a malformed response',
      'malformed',
    );
  }
  const envelope = doc['ENVELOPE'] as Record<string, unknown> | undefined;
  const body = envelope?.['BODY'] as Record<string, unknown> | undefined;
  if (!body) {
    throw new TallyError('Tally returned a malformed response', 'malformed');
  }
  return body;
}

export function parseCompanies(xml: string): string[] {
  const body = envelopeBody(xml);
  const data = body['DATA'] as Record<string, unknown> | undefined;
  const collection = data?.['COLLECTION'] as
    | Record<string, unknown>
    | undefined;
  const companies = asArray(
    collection?.['COMPANY'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  return companies
    .map((c) => text(c['@_NAME']))
    .filter((n): n is string => Boolean(n));
}

export function parseLedgers(xml: string): string[] {
  const body = envelopeBody(xml);
  const data = body['DATA'] as Record<string, unknown> | undefined;
  const collection = data?.['COLLECTION'] as
    | Record<string, unknown>
    | undefined;
  const ledgers = asArray(
    collection?.['LEDGER'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  return ledgers
    .map((l) => text(l['@_NAME']))
    .filter((n): n is string => Boolean(n));
}

export interface RawLedgerEntry {
  ledgerName?: string;
  isDeemedPositive?: string;
  amountRaw?: string;
}

export interface RawVoucher {
  remoteId?: string;
  guid?: string;
  voucherNo?: string;
  dateRaw?: string;
  voucherType?: string;
  narration?: string;
  reference?: string;
  partyLedgerName?: string;
  entries: RawLedgerEntry[];
}

export function parseVouchers(xml: string): RawVoucher[] {
  const body = envelopeBody(xml);
  const data = body['DATA'] as Record<string, unknown> | undefined;
  // TALLYMESSAGE may parse as a single object or an array depending on
  // response size/shape — normalize before reading VOUCHER entries.
  const messages = asArray(
    data?.['TALLYMESSAGE'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  const vouchers = messages.flatMap(
    (message) =>
      asArray(
        message?.['VOUCHER'] as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      ),
  );
  return vouchers.map((v) => {
    const entries = asArray(
      v['ALLLEDGERENTRIES.LIST'] as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    ).map((e) => ({
      ledgerName: text(e['LEDGERNAME']),
      isDeemedPositive: text(e['ISDEEMEDPOSITIVE']),
      amountRaw: text(e['AMOUNT']),
    }));
    return {
      remoteId: text(v['@_REMOTEID']),
      guid: text(v['GUID']),
      voucherNo: text(v['VOUCHERNUMBER']),
      dateRaw: text(v['DATE']),
      voucherType:
        text(v['@_VCHTYPE']) ?? text(v['VOUCHERTYPE']),
      narration: text(v['NARRATION']),
      reference: text(v['REFERENCE']),
      partyLedgerName: text(v['PARTYLEDGERNAME']),
      entries,
    };
  });
}
