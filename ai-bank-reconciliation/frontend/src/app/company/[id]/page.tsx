"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import {
  getAccessToken,
  setSelectedCompanyId,
  type CompanyDetail,
  type CompanyMember,
} from "@/lib/companies";

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
const input: React.CSSProperties = {
  padding: 8,
  margin: "4px 8px 4px 0",
};

const ROLES = ["ACCOUNTANT", "REVIEWER", "VIEWER"];

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");

  const [editName, setEditName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("ACCOUNTANT");

  const token = getAccessToken();

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    apiGet<CompanyDetail>(`/companies/${id}`, token)
      .then((c) => {
        setCompany(c);
        setEditName(c.companyName);
        setSelectedCompanyId(c.id);
        setError(null);
      })
      .catch((err: Error) => setError(err));
    apiGet<CompanyMember[]>(`/companies/${id}/members`, token)
      .then(setMembers)
      .catch((err: Error) => setError(err));
  }, [id, router, token]);

  async function load() {
    if (!token) {
      router.replace("/login");
      return;
    }
    try {
      const [c, m] = await Promise.all([
        apiGet<CompanyDetail>(`/companies/${id}`, token),
        apiGet<CompanyMember[]>(`/companies/${id}/members`, token),
      ]);
      setCompany(c);
      setMembers(m);
      setEditName(c.companyName);
      setSelectedCompanyId(c.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : "Load failed");
    }
  }

  if (error) {
    return (
      <main style={wrap}>
        <ApiErrorNotice error={error} />
        <Link href="/companies">Back to companies</Link>
      </main>
    );
  }
  if (!company) return <main style={wrap}>Loading…</main>;

  const isOwner = company.role === "OWNER";
  const storedUser =
    typeof window !== "undefined" ? localStorage.getItem("user") : null;
  const selfId: string | null = storedUser
    ? ((JSON.parse(storedUser) as { id?: string }).id ?? null)
    : null;

  async function run(action: () => Promise<unknown>, okMsg: string) {
    setNotice("");
    setError(null);
    try {
      await action();
      setNotice(okMsg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err : "Action failed");
    }
  }

  return (
    <main style={wrap}>
      <Link href="/companies">← Companies</Link>
      <h1>{company.companyName}</h1>

      <div style={card}>
        <h2>Company Information</h2>
        <p>Legal Name: {company.legalName ?? "—"}</p>
        <p>GSTIN: {company.gstin ?? "—"}</p>
        <p>PAN: {company.pan ?? "—"}</p>
        <p>Financial Year: {company.financialYear}</p>
        <p>Currency: {company.currency}</p>
        <p>Timezone: {company.timezone}</p>
        <p>Current User Role: {company.role}</p>
      </div>

      {isOwner && (
        <div style={card}>
          <h2>Edit Company</h2>
          <input
            style={input}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Company Name"
          />
          <button
            style={{ padding: "8px 16px", cursor: "pointer" }}
            onClick={() =>
              token &&
              run(
                () =>
                  apiPatch(`/companies/${id}`, { companyName: editName }, token),
                "Company updated",
              )
            }
          >
            Save
          </button>
        </div>
      )}

      <div style={card}>
        <h2>Members</h2>
        {members.map((m) => (
          <div key={m.userId}>
            <span>
              {m.user.name} ({m.user.email}) — {m.role}
            </span>{" "}
            {isOwner && m.role !== "OWNER" && (
              <>
                <select
                  value={m.role}
                  onChange={(e) =>
                    token &&
                    run(
                      () =>
                        apiPatch(
                          `/companies/${id}/members/${m.userId}`,
                          { role: e.target.value },
                          token,
                        ),
                      "Role updated",
                    )
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>{" "}
                <button
                  onClick={() =>
                    token &&
                    run(
                      () =>
                        apiDelete(
                          `/companies/${id}/members/${m.userId}`,
                          token,
                        ),
                      "Member removed",
                    )
                  }
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <div style={card}>
          <h2>Add Member</h2>
          <input
            style={input}
            type="email"
            placeholder="User email"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
          />
          <select
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>{" "}
          <button
            style={{ padding: "8px 16px", cursor: "pointer" }}
            onClick={() =>
              token &&
              run(
                () =>
                  apiPost(
                    `/companies/${id}/members`,
                    { email: memberEmail, role: memberRole },
                    token,
                  ),
                "Member added",
              )
            }
          >
            Add
          </button>
        </div>
      )}

      {!isOwner && selfId && (
        <div style={card}>
          <button
            onClick={() =>
              token &&
              run(
                () => apiDelete(`/companies/${id}/members/${selfId}`, token),
                "You left the company",
              )
            }
          >
            Leave Company
          </button>
        </div>
      )}

      {notice && <p style={{ color: "green" }}>{notice}</p>}
    </main>
  );
}
