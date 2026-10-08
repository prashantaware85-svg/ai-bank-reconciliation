"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";

interface Connection {
  id: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
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

export default function TallyPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[] | null>(null);
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
    apiGet<Connection[]>(`/tally/connections?companyId=${companyId}`, token)
      .then(setConnections)
      .catch((err: Error) => setError(err));
  }, [router, companyId]);

  if (!connections && !error) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <Link href="/companies">← Companies</Link>
      <h1>Tally Connections</h1>
      {error ? <ApiErrorNotice error={error} /> : null}
      {connections?.map((c) => (
        <div key={c.id} style={card}>
          <h3>{c.name}</h3>
          <p>Status: {c.status}</p>
          <p>
            Last Sync:{" "}
            {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "—"}
          </p>
          <Link href={`/tally/connections/${c.id}`}>
            <button style={{ padding: "8px 16px", cursor: "pointer" }}>
              Open
            </button>
          </Link>
        </div>
      ))}
      {connections?.length === 0 && <p>No Tally connections yet.</p>}
      <p>
        <Link href="/tally/connect">+ New Connection</Link>
      </p>
    </main>
  );
}
