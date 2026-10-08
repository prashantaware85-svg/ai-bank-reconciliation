"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";

interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
}

const box: React.CSSProperties = {
  maxWidth: 520,
  margin: "40px auto",
  padding: 24,
  border: "1px solid #ddd",
  borderRadius: 8,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: 8,
  margin: "8px 0",
  boxSizing: "border-box",
};

export default function NewReconciliationPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [fromDate, setFromDate] = useState("2026-09-01");
  const [toDate, setToDate] = useState("2026-09-30");
  const [tolerance, setTolerance] = useState("2");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    const companyId = getSelectedCompanyId();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!companyId) {
      router.replace("/companies");
      return;
    }
    apiGet<BankAccount[]>(`/bank-accounts?companyId=${companyId}`, token)
      .then((list) => {
        setAccounts(list);
        if (list[0]) setBankAccountId(list[0].id);
      })
      .catch((err: Error) => setError(err));
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<{ runId: string }>(
        "/reconciliation/runs",
        {
          bankAccountId,
          fromDate,
          toDate,
          dateToleranceDays: Number(tolerance),
        },
        token,
      );
      router.push(`/reconciliation/${data.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err : "Run failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={box}>
      <h1>New Reconciliation</h1>
      <form onSubmit={onSubmit}>
        <label>Bank Account</label>
        <select
          style={input}
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
          required
        >
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
          required
        />
        <label>To</label>
        <input
          style={input}
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          required
        />
        <label>Date Tolerance (days, 0–30)</label>
        <input
          style={input}
          type="number"
          min={0}
          max={30}
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
        />
        {error ? <ApiErrorNotice error={error} /> : null}
        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: 10, marginTop: 12, cursor: "pointer" }}
        >
          {loading ? "Running…" : "Start Reconciliation"}
        </button>
      </form>
      <p>
        <Link href="/reconciliation">Back to runs</Link>
      </p>
    </main>
  );
}
