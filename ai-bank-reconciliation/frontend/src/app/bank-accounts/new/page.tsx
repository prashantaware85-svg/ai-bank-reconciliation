"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";

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

export default function NewBankAccountPage() {
  const router = useRouter();
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [masked, setMasked] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
    setLoading(true);
    try {
      const data = await apiPost<{ id: string }>(
        `/bank-accounts?companyId=${companyId}`,
        {
          bankName,
          accountName,
          accountNumberMasked: masked,
          ifsc: ifsc || undefined,
          currency,
        },
        token,
      );
      router.push(`/bank-accounts/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : "Creation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={box}>
      <h1>New Bank Account</h1>
      <form onSubmit={onSubmit}>
        <input
          style={input}
          placeholder="Bank Name *"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          required
        />
        <input
          style={input}
          placeholder="Account Name *"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          required
        />
        <input
          style={input}
          placeholder="Masked Account Number * (e.g. XXXX1234)"
          value={masked}
          onChange={(e) => setMasked(e.target.value)}
          required
        />
        <input
          style={input}
          placeholder="IFSC"
          value={ifsc}
          onChange={(e) => setIfsc(e.target.value)}
        />
        <input
          style={input}
          placeholder="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        />
        {error ? <ApiErrorNotice error={error} /> : null}
        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: 10, marginTop: 12, cursor: "pointer" }}
        >
          {loading ? "Creating…" : "Create Bank Account"}
        </button>
      </form>
      <p>
        <Link href="/bank-accounts">Back to accounts</Link>
      </p>
    </main>
  );
}
