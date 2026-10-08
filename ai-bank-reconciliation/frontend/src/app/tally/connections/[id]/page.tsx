"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken } from "@/lib/companies";

interface ConnStatus {
  id: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
  reachable: boolean | null;
  liveCheck: string;
  lastSync: {
    id: string;
    status: string;
    completedAt: string | null;
    recordsImported: number;
    recordsFailed: number;
    errorMessage: string | null;
  } | null;
}

interface SyncResult {
  syncId: string;
  status: string;
  tallyCompany: string;
  bankLedger: string;
}

interface SyncDetail {
  id: string;
  status: string;
  tallyCompany: string;
  bankLedger: string;
  recordsReceived: number;
  recordsImported: number;
  recordsSkipped: number;
  recordsFailed: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

const wrap: React.CSSProperties = {
  maxWidth: 900,
  margin: "40px auto",
  padding: 24,
};
const card: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 16,
  margin: "12px 0",
};
const input: React.CSSProperties = { padding: 8, margin: "4px 8px 4px 0" };

export default function TallyConnectionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [status, setStatus] = useState<ConnStatus | null>(null);
  const [tallyCompany, setTallyCompany] = useState("");
  const [bankLedger, setBankLedger] = useState("");
  const [fromDate, setFromDate] = useState("2026-09-01");
  const [toDate, setToDate] = useState("2026-09-30");
  const [sync, setSync] = useState<SyncDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  function tokenOrRedirect(): string | null {
    const token = getAccessToken();
    if (!token) router.replace("/login");
    return token;
  }

  useEffect(() => {
    const token = tokenOrRedirect();
    if (!token) return;
    apiGet<ConnStatus>(`/tally/connections/${id}/status`, token)
      .then(setStatus)
      .catch((err: Error) => setError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function checkStatus() {
    setError(null);
    const token = tokenOrRedirect();
    if (!token) return;
    try {
      setStatus(await apiGet<ConnStatus>(`/tally/connections/${id}/status`, token));
    } catch (err) {
      setError(err instanceof Error ? err : "Status check failed");
    }
  }

  async function startSync(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSync(null);
    const token = tokenOrRedirect();
    if (!token) return;
    setLoading(true);
    try {
      const r = await apiPost<SyncResult>(
        `/tally/connections/${id}/sync`,
        { tallyCompany, bankLedger, fromDate, toDate },
        token,
      );
      const poll = async (): Promise<void> => {
        const s = await apiGet<SyncDetail>(`/tally/sync/${r.syncId}`, token);
        setSync(s);
        if (s.status === "PENDING" || s.status === "PROCESSING") {
          setTimeout(() => poll().catch(() => {}), 2000);
        }
      };
      await poll();
    } catch (err) {
      setError(err instanceof Error ? err : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  if (error && !status) {
    return (
      <main style={wrap}>
        <ApiErrorNotice error={error} />
        <Link href="/tally">Back to connections</Link>
      </main>
    );
  }
  if (!status) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <Link href="/tally">← Tally Connections</Link>
      <h1>{status.name}</h1>
      <div style={card}>
        <h2>Connection Status</h2>
        <p>Status: {status.status}</p>
        <p>
          Last Sync:{" "}
          {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "—"}
        </p>
        <p>
          Reachable:{" "}
          {status.reachable === null ? "Unknown (see note)" : String(status.reachable)}
        </p>
        <p>{status.liveCheck}</p>
        {status.lastSync && (
          <p>
            Last sync: {status.lastSync.status} — imported{" "}
            {status.lastSync.recordsImported}, failed{" "}
            {status.lastSync.recordsFailed}
            {status.lastSync.errorMessage
              ? ` — ${status.lastSync.errorMessage}`
              : ""}
          </p>
        )}
        <button onClick={checkStatus} style={{ padding: "8px 16px", cursor: "pointer" }}>
          Check Status
        </button>
      </div>

      <div style={card}>
        <h2>Sync Transactions</h2>
        <form onSubmit={startSync}>
          <input
            style={input}
            placeholder="Tally Company *"
            value={tallyCompany}
            onChange={(e) => setTallyCompany(e.target.value)}
            required
          />
          <input
            style={input}
            placeholder="Bank Ledger *"
            value={bankLedger}
            onChange={(e) => setBankLedger(e.target.value)}
            required
          />
          <input
            style={input}
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            required
          />
          <input
            style={input}
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Syncing…" : "Sync"}
          </button>
        </form>
        <p>
          After creating the sync, run the local agent:{" "}
          <code>node dist/cli.js sync --sync-id=&lt;id&gt;</code>
        </p>
        {error ? <ApiErrorNotice error={error} /> : null}
      </div>

      {sync && (
        <div style={card}>
          <h2>Sync Progress</h2>
          <p>Sync ID: {sync.id}</p>
          <p>Status: {sync.status}</p>
          <p>Received: {sync.recordsReceived}</p>
          <p>Imported: {sync.recordsImported}</p>
          <p>Skipped: {sync.recordsSkipped}</p>
          <p>Failed: {sync.recordsFailed}</p>
          {sync.errorMessage && (
            <p style={{ color: "red" }}>{sync.errorMessage}</p>
          )}
        </div>
      )}
    </main>
  );
}
