"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";

interface Run {
  id: string;
  status: string;
  fromDate: string;
  toDate: string;
  matchedCount: number;
  possibleMatchCount: number;
  unmatchedCount: number;
  exceptionCount: number;
  createdAt: string;
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

export default function ReconciliationPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
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
    apiGet<Run[]>(`/reconciliation/runs?companyId=${companyId}`, token)
      .then(setRuns)
      .catch((err: Error) => setError(err));
  }, [router, companyId]);

  if (!runs && !error) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <Link href="/companies">← Companies</Link>
      <h1>Reconciliation Runs</h1>
      {error ? <ApiErrorNotice error={error} /> : null}
      {runs?.map((r) => (
        <div key={r.id} style={card}>
          <p>
            {r.fromDate.slice(0, 10)} → {r.toDate.slice(0, 10)} — {r.status}
          </p>
          <p>
            Matched: {r.matchedCount}, Possible: {r.possibleMatchCount},
            Unmatched: {r.unmatchedCount}, Exceptions: {r.exceptionCount}
          </p>
          <Link href={`/reconciliation/${r.id}`}>
            <button style={{ padding: "8px 16px", cursor: "pointer" }}>
              Open
            </button>
          </Link>
        </div>
      ))}
      {runs?.length === 0 && <p>No reconciliation runs yet.</p>}
      <p>
        <Link href="/reconciliation/new">+ New Reconciliation</Link>
      </p>
    </main>
  );
}
