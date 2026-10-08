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

export default function TallyConnectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
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
        `/tally/connections?companyId=${companyId}`,
        { name },
        token,
      );
      router.push(`/tally/connections/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err : "Creation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={box}>
      <h1>New Tally Connection</h1>
      <p>
        The local Tally Agent on your PC will use this connection to push
        read-only voucher data. Ensure TallyPrime is running with XML enabled
        (port 9000) and a company loaded.
      </p>
      <form onSubmit={onSubmit}>
        <input
          style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
          placeholder="Connection Name * (e.g. Head Office Tally)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error ? <ApiErrorNotice error={error} /> : null}
        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: 10, marginTop: 12, cursor: "pointer" }}
        >
          {loading ? "Creating…" : "Connect"}
        </button>
      </form>
      <p>
        <Link href="/tally">Back to connections</Link>
      </p>
    </main>
  );
}
