#!/usr/bin/env node
/**
 * tally-agent CLI (local development executable).
 * Commands are read-only with respect to TallyPrime; only `sync` pushes
 * normalized data outbound to the backend (never writes into Tally).
 */
import { HttpTallyAdapter } from './adapter.js';
import { loadConfig, loadTallyConfig } from './config.js';
import { fetchSync, ingestBatch, reportFailure } from './sync.js';
import { TallyError } from './tally-xml.js';

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of process.argv.slice(3)) {
    const m = part.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1] as string] = m[2] as string;
  }
  return out;
}

function fail(error: unknown): never {
  const message =
    error instanceof TallyError || error instanceof Error
      ? error.message
      : 'Unknown agent error';
  // eslint-disable-next-line no-console
  console.error(`Error: ${message}`);
  if (process.env['TALLY_DEBUG'] === '1' && error instanceof Error) {
    // eslint-disable-next-line no-console
    console.error(error.stack ?? error);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const opts = args();

  try {
    switch (command) {
      case 'check': {
        const cfg = loadTallyConfig();
        const adapter = new HttpTallyAdapter(cfg.tallyBaseUrl, cfg.tallyTimeoutMs);
        const { latencyMs } = await adapter.checkConnection();
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({ ok: true, tally: cfg.tallyBaseUrl, latencyMs }),
        );
        break;
      }
      case 'companies': {
        const cfg = loadTallyConfig();
        const adapter = new HttpTallyAdapter(cfg.tallyBaseUrl, cfg.tallyTimeoutMs);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(await adapter.getCompanies(), null, 2));
        break;
      }
      case 'ledgers': {
        const cfg = loadTallyConfig();
        const adapter = new HttpTallyAdapter(cfg.tallyBaseUrl, cfg.tallyTimeoutMs);
        const bankOnly = opts['bank-only'] === 'true';
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            bankOnly ? await adapter.getBankLedgers() : await adapter.getLedgers(),
            null,
            2,
          ),
        );
        break;
      }
      case 'vouchers': {
        const cfg = loadTallyConfig();
        const adapter = new HttpTallyAdapter(cfg.tallyBaseUrl, cfg.tallyTimeoutMs);
        const from = opts['from'];
        const to = opts['to'];
        if (!from || !to) throw new Error('Usage: vouchers --from=YYYY-MM-DD --to=YYYY-MM-DD');
        const batch = await adapter.getTransactions({
          tallyCompany: opts['company'] ?? '',
          bankLedger: opts['bank-ledger'] ?? '',
          fromDate: from,
          toDate: to,
        });
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(batch, null, 2));
        break;
      }
      case 'sync': {
        const cfg = loadConfig(process.env, { requireBackendJwt: true });
        const adapter = new HttpTallyAdapter(cfg.tallyBaseUrl, cfg.tallyTimeoutMs);
        const syncId = opts['sync-id'];
        if (!syncId) throw new Error('Usage: sync --sync-id=<id>');
        const sync = await fetchSync(cfg.backendUrl, cfg.backendJwt, syncId, cfg.tallyTimeoutMs);
        const batch = await adapter.getTransactions({
          tallyCompany: sync.tallyCompany,
          bankLedger: sync.bankLedger,
          fromDate: sync.fromDate ?? '',
          toDate: sync.toDate ?? '',
        });
        const result = await ingestBatch(
          cfg.backendUrl,
          cfg.backendJwt,
          syncId,
          batch.transactions,
          true,
          cfg.tallyTimeoutMs,
        );
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({ ...((result ?? {}) as object), skippedVouchers: batch.skipped }),
        );
        break;
      }
      case 'fail': {
        const cfg = loadConfig(process.env, { requireBackendJwt: true });
        const syncId = opts['sync-id'];
        const message = opts['message'] ?? 'manual failure report';
        if (!syncId) throw new Error('Usage: fail --sync-id=<id> --message=<text>');
        await reportFailure(cfg.backendUrl, cfg.backendJwt, syncId, message, cfg.tallyTimeoutMs);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ ok: true }));
        break;
      }
      default: {
        // eslint-disable-next-line no-console
        console.log(
          'Usage: tally-agent <check|companies|ledgers|vouchers|sync|fail> [options]',
        );
        process.exit(2);
      }
    }
  } catch (error) {
    // Report Tally outages to the backend when a sync was in progress.
    const syncId = args()['sync-id'];
    if (process.argv[2] === 'sync' && syncId && error instanceof TallyError) {
      try {
        const cfg = loadConfig(process.env, { requireBackendJwt: true });
        await reportFailure(
          cfg.backendUrl,
          cfg.backendJwt,
          syncId,
          error.message,
          cfg.tallyTimeoutMs,
        );
      } catch {
        // reporting must never mask the original error
      }
    }
    fail(error);
  }
}

await main();
