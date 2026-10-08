"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken, getSelectedCompanyId } from "@/lib/companies";

interface PartyAlias {
  id: string;
  canonicalParty: string;
  alias: string;
  normalizedAlias: string;
  isApproved: boolean;
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
const input: React.CSSProperties = { padding: 8, margin: "4px 8px 4px 0" };

export default function PartyAliasesPage() {
  const router = useRouter();
  const [aliases, setAliases] = useState<PartyAlias[] | null>(null);
  const [canonicalParty, setCanonicalParty] = useState("");
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [companyId] = useState<string | null>(() => getSelectedCompanyId());

  function load() {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!companyId) {
      router.replace("/companies");
      return;
    }
    apiGet<PartyAlias[]>(`/party-aliases?companyId=${companyId}`, token)
      .then(setAliases)
      .catch((err: Error) => setError(err));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice("");
    const token = getAccessToken();
    if (!token) return;
    try {
      await apiPost(
        `/party-aliases?companyId=${companyId}`,
        { canonicalParty, alias },
        token,
      );
      setNotice("Alias created (pending approval)");
      setCanonicalParty("");
      setAlias("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err : "Creation failed");
    }
  }

  async function onApprove(id: string) {
    setError(null);
    setNotice("");
    const token = getAccessToken();
    if (!token) return;
    try {
      await apiPatch(`/party-aliases/${id}/approve`, {}, token);
      setNotice("Alias approved");
      load();
    } catch (err) {
      setError(err instanceof Error ? err : "Approval failed");
    }
  }

  return (
    <main style={wrap}>
      <Link href="/companies">← Companies</Link>
      <h1>Party Aliases</h1>
      <p>
        Human-approved alias relationships (canonical “ABC Traders” ← alias
        “ABC Traders Pvt Ltd”). Never created automatically from AI.
      </p>
      {error ? <ApiErrorNotice error={error} /> : null}
      {notice && <p style={{ color: "green" }}>{notice}</p>}

      <div style={card}>
        <h2>New Alias</h2>
        <form onSubmit={onCreate}>
          <input
            style={input}
            placeholder="Canonical Party * (e.g. ABC Traders)"
            value={canonicalParty}
            onChange={(e) => setCanonicalParty(e.target.value)}
            required
          />
          <input
            style={input}
            placeholder="Alias * (e.g. ABC Traders Pvt Ltd)"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            required
          />
          <button type="submit" style={{ padding: "8px 16px", cursor: "pointer" }}>
            Create Alias
          </button>
        </form>
      </div>

      {(aliases ?? []).map((a) => (
        <div key={a.id} style={card}>
          <p>
            <strong>{a.canonicalParty}</strong> ← {a.alias} —{" "}
            {a.isApproved ? "Approved" : "Pending approval"}
          </p>
          {!a.isApproved && (
            <button
              onClick={() => onApprove(a.id)}
              style={{ padding: "8px 16px", cursor: "pointer" }}
            >
              Approve
            </button>
          )}
        </div>
      ))}
      {aliases?.length === 0 && <p>No party aliases yet.</p>}
    </main>
  );
}
