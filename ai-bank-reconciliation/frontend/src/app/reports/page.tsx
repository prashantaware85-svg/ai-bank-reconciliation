"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, downloadFile } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";
import { formatINR } from "@/lib/format";

interface PartyException {
  party: string;
  transactionCount: number;
  totalAmount: string;
  wrongPartyCandidates: number;
  confirmedWrongParty: number;
  duplicateCandidates: number;
  amountMismatches: number;
  reviewRequired: number;
}

const wrap: React.CSSProperties = {
  maxWidth: 1100,
  margin: "40px auto",
  padding: 24,
};
const card: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 16,
  margin: "12px 0",
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

const REPORTS = [
  {
    key: "RECONCILIATION",
    name: "Reconciliation Report",
    status: "REVIEW_REQUIRED",
    excel: "/reports/export/reconciliation.xlsx",
    pdf: "/reports/export/reconciliation.pdf",
  },
  {
    key: "EXCEPTIONS",
    name: "Exception Report",
    status: "REVIEW_REQUIRED",
    excel: "/reports/export/exceptions.xlsx",
    pdf: "/reports/export/exceptions.pdf",
  },
  {
    key: "REVIEW",
    name: "Review Report",
    status: "",
    excel: "",
    pdf: "/reports/export/review.pdf",
  },
  {
    key: "AI",
    name: "AI Analysis Report",
    status: "",
    excel: "/reports/export/reconciliation.xlsx",
    pdf: "",
  },
  {
    key: "PARTY",
    name: "Party Exception Report",
    status: "",
    excel: "/reports/export/exceptions.xlsx",
    pdf: "/reports/export/exceptions.pdf",
  },
];

export default function ReportsPage() {
  const router = useRouter();
  const [party, setParty] = useState<PartyException[]>([]);
  const [partyFilter, setPartyFilter] = useState("");
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState("2026-12-31");
  const [error, setError] = useState<unknown>(null);
  const [companyId] = useState<string | null>(() => getSelectedCompanyId());

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
  }, [companyId, router]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !companyId) return;
    const q =
      `?companyId=${companyId}` +
      `${fromDate ? `&fromDate=${fromDate}` : ""}` +
      `${toDate ? `&toDate=${toDate}` : ""}`;
    apiGet<PartyException[]>(`/reports/party-exceptions${q}`, token)
      .then(setParty)
      .catch((err: Error) => setError(err));
  }, [companyId, fromDate, toDate]);

  function exportPath(path: string, status: string): string {
    return (
      `${path}?companyId=${companyId ?? ""}` +
      `${fromDate ? `&fromDate=${fromDate}` : ""}` +
      `${toDate ? `&toDate=${toDate}` : ""}` +
      `${status ? `&status=${status}` : ""}`
    );
  }

  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);

  async function onExport(path: string, filename: string) {
    setExportBusy(path);
    setExportError(null);
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    try {
      await downloadFile(path, filename, token);
    } catch (err) {
      setExportError(err instanceof Error ? err : "Export failed");
    } finally {
      setExportBusy(null);
    }
  }

  const filtered = party.filter((p) =>
    partyFilter ? p.party.includes(partyFilter.toUpperCase()) : true,
  );

  return (
    <main style={wrap}>
      <Link href="/dashboard">← Dashboard</Link>
      <h1>Reports</h1>
      {error ? <ApiErrorNotice error={error} /> : null}

      <div style={card}>
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
      </div>

      <div style={card}>
        <h2>Available Reports</h2>
        {exportError ? <ApiErrorNotice error={exportError} /> : null}
        {REPORTS.map((r) => (
          <div key={r.key}>
            <strong>{r.name}</strong>{" "}
            {r.excel && (
              <button
                type="button"
                disabled={exportBusy !== null}
                onClick={() =>
                  onExport(
                    exportPath(r.excel, r.status),
                    `${r.key.toLowerCase()}.xlsx`,
                  )
                }
              >
                Export Excel
              </button>
            )}{" "}
            {r.pdf && (
              <button
                type="button"
                disabled={exportBusy !== null}
                onClick={() =>
                  onExport(
                    exportPath(r.pdf, r.status),
                    `${r.key.toLowerCase()}.pdf`,
                  )
                }
              >
                Export PDF
              </button>
            )}
          </div>
        ))}
        <p>
          <Link href="/dashboard">Open dashboard for live counts</Link>
        </p>
      </div>

      <div style={card}>
        <h2>Party Exception Report</h2>
        <input
          style={input}
          placeholder="Filter by party"
          value={partyFilter}
          onChange={(e) => setPartyFilter(e.target.value)}
        />
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Party</th>
              <th style={th}>Transactions</th>
              <th style={th}>Total Amount</th>
              <th style={th}>Wrong Party Candidates</th>
              <th style={th}>Confirmed Wrong Party</th>
              <th style={th}>Duplicate Candidates</th>
              <th style={th}>Amount Mismatches</th>
              <th style={th}>Review Required</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.party}>
                <td style={td}>{p.party}</td>
                <td style={td}>{p.transactionCount}</td>
                <td style={td}>{formatINR(p.totalAmount)}</td>
                <td style={td}>{p.wrongPartyCandidates}</td>
                <td style={td}>{p.confirmedWrongParty}</td>
                <td style={td}>{p.duplicateCandidates}</td>
                <td style={td}>{p.amountMismatches}</td>
                <td style={td}>{p.reviewRequired}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td style={td} colSpan={8}>
                  No party exceptions in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
