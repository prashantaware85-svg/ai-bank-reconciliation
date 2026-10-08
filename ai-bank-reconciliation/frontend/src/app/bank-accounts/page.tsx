"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";

interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  ifsc: string | null;
  currency: string;
  isActive: boolean;
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

export default function BankAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
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
    apiGet<BankAccount[]>(`/bank-accounts?companyId=${companyId}`, token)
      .then(setAccounts)
      .catch((err: Error) => setError(err));
  }, [router, companyId]);

  if (!accounts && !error) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <Link href="/companies">← Companies</Link>
      <h1>Bank Accounts</h1>
      {error ? <ApiErrorNotice error={error} /> : null}
      {accounts?.map((a) => (
        <div key={a.id} style={card}>
          <h3>
            {a.bankName} — {a.accountName}
          </h3>
          <p>Masked Account Number: {a.accountNumberMasked}</p>
          <p>IFSC: {a.ifsc ?? "—"}</p>
          <p>Currency: {a.currency}</p>
          <p>Status: {a.isActive ? "Active" : "Inactive"}</p>
          <Link href={`/bank-accounts/${a.id}`}>
            <button style={{ padding: "8px 16px", cursor: "pointer" }}>
              Open
            </button>
          </Link>{" "}
          <Link href={`/bank-accounts/${a.id}/import`}>
            <button style={{ padding: "8px 16px", cursor: "pointer" }}>
              Import Statement
            </button>
          </Link>
        </div>
      ))}
      <p>
        <Link href="/bank-accounts/new">+ New Bank Account</Link>
      </p>
    </main>
  );
}
