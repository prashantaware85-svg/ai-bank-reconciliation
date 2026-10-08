"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, API_URL, downloadFile } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { formatINR, pct } from "@/lib/format";
import {
  getAccessToken,
  getSelectedCompanyId,
  type CompanyMember,
} from "@/lib/companies";

interface BankAccountOption {
  id: string;
  bankName: string;
  accountName: string;
}

interface Dashboard {
  company: { companyName: string; currency: string };
  kpis: {
    totalBankTransactions: number;
    totalTallyTransactions: number;
    totalResults: number;
    matched: number;
    possibleMatch: number;
    unmatched: number;
    reviewRequired: number;
    amountMismatch: number;
    dateMismatch: number;
    missingInTally: number;
    missingInBank: number;
    pendingReview: number;
    inReview: number;
    confirmed: number;
    confirmedWrongParty: number;
    confirmedDuplicate: number;
    rejected: number;
    ignored: number;
  };
  health: {
    matchedPct: string;
    possiblePct: string;
    exceptionsPct: string;
    pendingPct: string;
  };
  amounts: {
    totalBank: string;
    totalTally: string;
    matchedBank: string;
    unmatchedBank: string;
    unmatchedTally: string;
  };
  statusChart: { status: string; count: number }[];
  reviewChart: { status: string; count: number }[];
  bankAccounts: {
    bankAccountId: string;
    bankName: string;
    accountName: string;
    transactions: number;
    bankAmount: string;
    tallyAmount: string;
    matched: number;
    unmatched: number;
    pendingReview: number;
    exceptions: number;
    difference: string;
  }[];
}

interface Trend {
  month: string;
  total: number;
  matched: number;
  exceptions: number;
  pendingReview: number;
  confirmed: number;
}

interface AiSummary {
  total: number;
  byClassification: Record<string, number>;
  byRisk: Record<string, number>;
  confidenceDistribution: { high: number; medium: number; low: number };
  disclaimer: string;
}

const wrap: React.CSSProperties = {
  maxWidth: 1100,
  margin: "30px auto",
  padding: 24,
};
const card: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 16,
  margin: "12px 0",
};
const kpiGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
};
const kpi: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 12,
  textAlign: "center",
};
const table: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: 12,
};
const th: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: 4,
  background: "#f5f5f5",
  textAlign: "left",
};
const td: React.CSSProperties = { border: "1px solid #ccc", padding: 4 };
const input: React.CSSProperties = { padding: 6, margin: "4px 8px 4px 0" };
const bar: React.CSSProperties = {
  height: 12,
  background: "#2563eb",
  borderRadius: 3,
};

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={kpi}>
      <div style={{ fontSize: 11, color: "#555" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function BarChart({
  title,
  data,
  total,
  linkBase,
}: {
  title: string;
  data: { status: string; count: number }[];
  total: number;
  linkBase: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={card}>
      <h3>{title}</h3>
      {data.map((d) => (
        <div key={d.status} style={{ marginBottom: 6 }}>
          <Link
            href={`${linkBase}?status=${d.status}`}
            style={{ fontSize: 11 }}
          >
            {d.status}
          </Link>{" "}
          <span style={{ fontSize: 11, color: "#555" }}>
            {d.count} ({pct(d.count, total)})
          </span>
          <div style={{ ...bar, width: `${(d.count / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [user, setUser] = useState<CompanyMember["user"] | null>(null);
  const [companyId] = useState<string | null>(() => getSelectedCompanyId());
  const [bankAccountId, setBankAccountId] = useState("");
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState("2026-12-31");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [ai, setAi] = useState<AiSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!companyId) {
      router.replace("/companies");
      return;
    }
    apiGet<BankAccountOption[]>(`/bank-accounts?companyId=${companyId}`, token)
      .then((list) => {
        setAccounts(list);
        if (list[0]) setBankAccountId(list[0].id);
      })
      .catch((err: Error) => setError(err));
    const stored = localStorage.getItem("user");
    Promise.resolve(
      stored ? (JSON.parse(stored) as CompanyMember["user"]) : null,
    ).then(setUser);
  }, [companyId, router]);

  useEffect(() => {
    if (!companyId) return;
    const token = getAccessToken();
    if (!token) return;
    const q =
      `?companyId=${companyId}` +
      `${bankAccountId ? `&bankAccountId=${bankAccountId}` : ""}` +
      `${fromDate ? `&fromDate=${fromDate}` : ""}` +
      `${toDate ? `&toDate=${toDate}` : ""}`;
    apiGet<Dashboard>(`/reports/dashboard${q}`, token)
      .then((d) => {
        setDash(d);
        setError(null);
      })
      .catch((err: Error) => setError(err));
    apiGet<Trend[]>(`/reports/monthly-trend${q}`, token)
      .then(setTrend)
      .catch(() => {});
    apiGet<AiSummary>(`/reports/ai-summary?companyId=${companyId}`, token)
      .then(setAi)
      .catch(() => {});
  }, [bankAccountId, companyId, fromDate, toDate]);

  async function onExport(path: string, filename: string) {
    setExportBusy(path);
    setExportError(null);
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    try {
      await downloadFile(`${path}${exportQ}`, filename, token);
    } catch (err) {
      setExportError(err instanceof Error ? err : "Export failed");
    } finally {
      setExportBusy(null);
    }
  }

  async function onLogout() {
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    localStorage.removeItem("selectedCompanyId");
    router.push("/login");
  }

  if (error && !dash) {
    return (
      <main style={wrap}>
        <ApiErrorNotice error={error} />
        <Link href="/companies">Back to companies</Link>
      </main>
    );
  }
  if (!dash) return <main style={wrap}>Loading…</main>;

  const exportQ =
    `?companyId=${companyId ?? ""}` +
    `${bankAccountId ? `&bankAccountId=${bankAccountId}` : ""}` +
    `${fromDate ? `&fromDate=${fromDate}` : ""}` +
    `${toDate ? `&toDate=${toDate}` : ""}`;

  return (
    <main style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <Link href="/companies">← Companies</Link>{" "}
          <Link href="/reports">Reports</Link>{" "}
          <Link href="/party-aliases">Party Aliases</Link>
        </div>
        <div>
          {user?.name} <button onClick={onLogout}>Logout</button>
        </div>
      </div>
      <h1>AI Bank Reconciliation Dashboard</h1>

      <div style={card}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <p style={{ fontSize: 11, color: "#555" }}>
            Changing any filter reloads the dashboard automatically.
          </p>
          <label>Bank Account</label>
          <select
            style={input}
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} — {a.accountName}
              </option>
            ))}
          </select>
          <label>From</label>
          <input
            style={input}
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <label>To</label>
          <input
            style={input}
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
          <button type="submit">Apply</button>
        </form>
        {error ? <ApiErrorNotice error={error} /> : null}
      </div>

      <h2>KPIs</h2>
      <div style={kpiGrid}>
        <KpiCard label="Bank Transactions" value={dash.kpis.totalBankTransactions} />
        <KpiCard label="Tally Transactions" value={dash.kpis.totalTallyTransactions} />
        <KpiCard label="Matched" value={dash.kpis.matched} />
        <KpiCard label="Possible Match" value={dash.kpis.possibleMatch} />
        <KpiCard label="Unmatched" value={dash.kpis.unmatched} />
        <KpiCard label="Review Required" value={dash.kpis.reviewRequired} />
        <KpiCard label="Missing in Tally" value={dash.kpis.missingInTally} />
        <KpiCard label="Missing in Bank" value={dash.kpis.missingInBank} />
        <KpiCard label="Amount Mismatch" value={dash.kpis.amountMismatch} />
        <KpiCard label="Date Mismatch" value={dash.kpis.dateMismatch} />
        <KpiCard label="Pending Review" value={dash.kpis.pendingReview} />
        <KpiCard label="Confirmed" value={dash.kpis.confirmed} />
        <KpiCard label="Rejected" value={dash.kpis.rejected} />
        <KpiCard label="Ignored" value={dash.kpis.ignored} />
      </div>

      <h2>Reconciliation Health</h2>
      <div style={kpiGrid}>
        <KpiCard label="Matched" value={dash.health.matchedPct} />
        <KpiCard label="Possible" value={dash.health.possiblePct} />
        <KpiCard label="Exceptions" value={dash.health.exceptionsPct} />
        <KpiCard label="Pending" value={dash.health.pendingPct} />
      </div>

      <h2>Amount Summary</h2>
      <div style={kpiGrid}>
        <KpiCard label="Total Bank" value={formatINR(dash.amounts.totalBank)} />
        <KpiCard label="Total Tally" value={formatINR(dash.amounts.totalTally)} />
        <KpiCard label="Matched Bank" value={formatINR(dash.amounts.matchedBank)} />
        <KpiCard label="Unmatched Bank" value={formatINR(dash.amounts.unmatchedBank)} />
        <KpiCard label="Unmatched Tally" value={formatINR(dash.amounts.unmatchedTally)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <BarChart
          title="Reconciliation Status (click to filter)"
          data={dash.statusChart}
          total={dash.kpis.totalResults}
          linkBase="/reconciliation"
        />
        <BarChart
          title="Review Outcomes"
          data={dash.reviewChart}
          total={dash.kpis.totalResults}
          linkBase="/reconciliation"
        />
      </div>

      <div style={card}>
        <h3>Monthly Trend</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Month</th>
              <th style={th}>Total</th>
              <th style={th}>Matched</th>
              <th style={th}>Exceptions</th>
              <th style={th}>Pending Review</th>
              <th style={th}>Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((t) => (
              <tr key={t.month}>
                <td style={td}>{t.month}</td>
                <td style={td}>{t.total}</td>
                <td style={td}>{t.matched}</td>
                <td style={td}>{t.exceptions}</td>
                <td style={td}>{t.pendingReview}</td>
                <td style={td}>{t.confirmed}</td>
              </tr>
            ))}
            {trend.length === 0 && (
              <tr>
                <td style={td} colSpan={6}>
                  No reconciliation results in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3>Bank Account Summary</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Account</th>
              <th style={th}>Transactions</th>
              <th style={th}>Bank Amount</th>
              <th style={th}>Tally Amount</th>
              <th style={th}>Matched</th>
              <th style={th}>Unmatched</th>
              <th style={th}>Pending Review</th>
              <th style={th}>Exceptions</th>
              <th style={th}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {dash.bankAccounts.map((a) => (
              <tr key={a.bankAccountId}>
                <td style={td}>
                  <Link href={`/reconciliation?bankAccountId=${a.bankAccountId}`}>
                    {a.bankName} — {a.accountName}
                  </Link>
                </td>
                <td style={td}>{a.transactions}</td>
                <td style={td}>{formatINR(a.bankAmount)}</td>
                <td style={td}>{formatINR(a.tallyAmount)}</td>
                <td style={td}>{a.matched}</td>
                <td style={td}>{a.unmatched}</td>
                <td style={td}>{a.pendingReview}</td>
                <td style={td}>{a.exceptions}</td>
                <td style={td}>{formatINR(a.difference)}</td>
              </tr>
            ))}
            {dash.bankAccounts.length === 0 && (
              <tr>
                <td style={td} colSpan={9}>
                  No bank accounts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3>AI Exception Summary (AI ASSISTED / REVIEW REQUIRED)</h3>
        <p>
          Analyses: {ai?.total ?? 0} — Wrong Party:{" "}
          {ai?.byClassification.wrongPartyCandidates ?? 0} — Duplicate:{" "}
          {ai?.byClassification.duplicateCandidates ?? 0} — Amount Anomalies:{" "}
          {ai?.byClassification.amountAnomalies ?? 0} — Date Anomalies:{" "}
          {ai?.byClassification.dateAnomalies ?? 0} — No Exception:{" "}
          {ai?.byClassification.noException ?? 0}
        </p>
        <p>
          Confidence: High {ai?.confidenceDistribution.high ?? 0}, Medium{" "}
          {ai?.confidenceDistribution.medium ?? 0}, Low{" "}
          {ai?.confidenceDistribution.low ?? 0}
        </p>
        <p style={{ color: "#a60", fontSize: 12 }}>{ai?.disclaimer}</p>
      </div>

      <div style={card}>
        <h3>Exports</h3>
        {exportError ? <ApiErrorNotice error={exportError} /> : null}
        <button
          type="button"
          disabled={exportBusy !== null}
          onClick={() => onExport("/reports/export/reconciliation.xlsx", "reconciliation.xlsx")}
        >
          Export Excel
        </button>{" "}
        <button
          type="button"
          disabled={exportBusy !== null}
          onClick={() => onExport("/reports/export/reconciliation.pdf", "reconciliation.pdf")}
        >
          Export PDF
        </button>{" "}
        <button
          type="button"
          disabled={exportBusy !== null}
          onClick={() => onExport("/reports/export/exceptions.xlsx", "exceptions.xlsx")}
        >
          Export Exceptions (Excel)
        </button>{" "}
        <button
          type="button"
          disabled={exportBusy !== null}
          onClick={() => onExport("/reports/export/exceptions.pdf", "exceptions.pdf")}
        >
          Export Exceptions (PDF)
        </button>
      </div>
    </main>
  );
}
