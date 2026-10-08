"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken } from "@/lib/companies";

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

export default function NewCompanyPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [financialYear, setFinancialYear] = useState("2026-27");
  const [currency, setCurrency] = useState("INR");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

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
      const data = await apiPost<{ id: string }>(
        "/companies",
        {
          companyName,
          legalName: legalName || undefined,
          gstin: gstin || undefined,
          pan: pan || undefined,
          financialYear,
          currency,
          timezone,
        },
        token,
      );
      router.push(`/company/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : "Creation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={box}>
      <h1>New Company</h1>
      <form onSubmit={onSubmit}>
        <input
          style={input}
          placeholder="Company Name *"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
        />
        <input
          style={input}
          placeholder="Legal Name"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
        />
        <input
          style={input}
          placeholder="GSTIN"
          value={gstin}
          onChange={(e) => setGstin(e.target.value)}
        />
        <input
          style={input}
          placeholder="PAN"
          value={pan}
          onChange={(e) => setPan(e.target.value)}
        />
        <input
          style={input}
          placeholder="Financial Year * (e.g. 2026-27)"
          value={financialYear}
          onChange={(e) => setFinancialYear(e.target.value)}
          required
        />
        <input
          style={input}
          placeholder="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        />
        <input
          style={input}
          placeholder="Timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
        {error ? <ApiErrorNotice error={error} /> : null}
        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: 10, marginTop: 12, cursor: "pointer" }}
        >
          {loading ? "Creating…" : "Create Company"}
        </button>
      </form>
      <p>
        <Link href="/companies">Back to companies</Link>
      </p>
    </main>
  );
}
