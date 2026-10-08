"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken } from "@/lib/companies";

interface BankAccount {
  id: string;
  companyId: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  ifsc: string | null;
  currency: string;
  isActive: boolean;
}

interface BankImport {
  id: string;
  fileName: string;
  fileType: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  status: string;
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

export default function BankAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [imports, setImports] = useState<BankImport[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiGet<BankAccount>(`/bank-accounts/${id}`, token)
      .then((a) => {
        setAccount(a);
        return apiGet<BankImport[]>(
          `/bank-imports?companyId=${a.companyId}&bankAccountId=${id}`,
          token,
        );
      })
      .then(setImports)
      .catch((err: Error) => setError(err));
  }, [id, router]);

  if (error) {
    return (
      <main style={wrap}>
        <ApiErrorNotice error={error} />
        <Link href="/bank-accounts">Back to accounts</Link>
      </main>
    );
  }
  if (!account) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <Link href="/bank-accounts">← Bank Accounts</Link>
      <h1>
        {account.bankName} — {account.accountName}
      </h1>
      <div style={card}>
        <p>Masked Account Number: {account.accountNumberMasked}</p>
        <p>IFSC: {account.ifsc ?? "—"}</p>
        <p>Currency: {account.currency}</p>
        <p>Status: {account.isActive ? "Active" : "Inactive"}</p>
        <Link href={`/bank-accounts/${id}/import`}>
          <button style={{ padding: "8px 16px", cursor: "pointer" }}>
            Import Statement
          </button>
        </Link>
      </div>
      <h2>Imports</h2>
      {imports.map((i) => (
        <div key={i.id} style={card}>
          <p>
            {i.fileName} ({i.fileType}) — {i.status}
          </p>
          <p>
            Total: {i.totalRows}, Imported: {i.importedRows}, Skipped:{" "}
            {i.skippedRows}, Failed: {i.failedRows}
          </p>
        </div>
      ))}
    </main>
  );
}
