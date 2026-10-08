"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import {
  getAccessToken,
  getSelectedCompanyId,
  type CompanyListItem,
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

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected] = useState<string | null>(() => getSelectedCompanyId());

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiGet<CompanyListItem[]>("/companies", token)
      .then(setCompanies)
      .catch((err: Error) => setError(err));
  }, [router]);

  if (!companies && !error) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <h1>Companies</h1>
      {error ? <ApiErrorNotice error={error} /> : null}
      {companies && companies.length === 0 && (
        <div style={card}>
          <p>No company found</p>
          <Link href="/company/new">
            <button style={{ padding: "8px 16px", cursor: "pointer" }}>
              Create Company
            </button>
          </Link>
        </div>
      )}
      {companies &&
        companies.map((c) => (
          <div key={c.id} style={card}>
            <h3>
              {c.companyName}{" "}
              {selected === c.id && <span>(Currently selected)</span>}
            </h3>
            <p>GSTIN: {c.gstin ?? "—"}</p>
            <p>Financial Year: {c.financialYear}</p>
            <p>Role: {c.role}</p>
            <p>Created: {new Date(c.createdAt).toLocaleDateString()}</p>
            <Link href={`/company/${c.id}`}>
              <button style={{ padding: "8px 16px", cursor: "pointer" }}>
                Open
              </button>
            </Link>
          </div>
        ))}
      {companies && companies.length > 0 && (
        <p>
          <Link href="/company/new">+ New Company</Link>
        </p>
      )}
    </main>
  );
}
