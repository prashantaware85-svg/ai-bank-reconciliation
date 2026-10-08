"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { API_URL } from "@/lib/api";
import { ApiRequestError, readRequestId } from "@/lib/api-errors";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken } from "@/lib/companies";

const wrap: React.CSSProperties = {
  maxWidth: 1000,
  margin: "40px auto",
  padding: 24,
};
const card: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 16,
  margin: "12px 0",
};
const table: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: 12,
};
const th: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: 4,
  background: "#f5f5f5",
};
const td: React.CSSProperties = { border: "1px solid #ccc", padding: 4 };

const FIELDS = [
  "transactionDate",
  "valueDate",
  "description",
  "narration",
  "chequeNumber",
  "reference",
  "debit",
  "credit",
  "amount",
  "balance",
];

interface Preview {
  fileName: string;
  fileType: string;
  totalRows: number;
  detectedColumns: string[];
  mapping: Record<string, string> | null;
  unmappedColumns: string[];
  warnings: string[];
  errors: string[];
  previewRows: Record<string, unknown>[];
}

interface Summary {
  file: string;
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  warnings: string[];
  rowErrors: { rowIndex: number; message: string }[];
  dateRange: { min: string; max: string } | null;
  totalDebit: string;
  totalCredit: string;
}

async function postFile<T>(
  url: string,
  file: File,
  token: string,
  extra?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? `Request failed (${res.status})`);
    throw new ApiRequestError(message, res.status, readRequestId(res.headers));
  }
  return data as T;
}

export default function ImportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSummary(null);
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!file) {
      setError("Select a .xlsx, .xls or .csv file first");
      return;
    }
    setLoading(true);
    try {
      const p = await postFile<Preview>(
        `${API_URL}/bank-accounts/${id}/import/preview`,
        file,
        token,
      );
      setPreview(p);
      setMapping(p.mapping ?? {});
    } catch (err) {
      setError(err instanceof Error ? err : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function onConfirm() {
    setError(null);
    const token = getAccessToken();
    if (!token || !file) return;
    setLoading(true);
    try {
      const r = await postFile<{ importId: string; summary: Summary }>(
        `${API_URL}/bank-accounts/${id}/import`,
        file,
        token,
        {
          mapping: JSON.stringify(mapping),
          allowDuplicate: String(allowDuplicate),
        },
      );
      setSummary(r.summary);
    } catch (err) {
      setError(err instanceof Error ? err : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={wrap}>
      <Link href={`/bank-accounts/${id}`}>← Bank Account</Link>
      <h1>Import Bank Statement</h1>

      <div style={card}>
        <h2>1. Upload (.xlsx, .xls, .csv — max 10 MB)</h2>
        <form onSubmit={onPreview}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />{" "}
          <button type="submit" disabled={loading}>
            {loading ? "Working…" : "Validate & Detect Columns"}
          </button>
        </form>
        {error ? <ApiErrorNotice error={error} /> : null}
      </div>

      {preview && (
        <div style={card}>
          <h2>2. Column Mapping</h2>
          <p>
            File: {preview.fileName} ({preview.fileType}) — Total rows:{" "}
            {preview.totalRows}
          </p>
          {preview.errors.map((e) => (
            <p key={e} style={{ color: "red" }}>
              {e}
            </p>
          ))}
          {preview.warnings.map((w) => (
            <p key={w} style={{ color: "#a60" }}>
              Warning: {w}
            </p>
          ))}
          {FIELDS.map((f) => (
            <div key={f}>
              <label style={{ display: "inline-block", width: 160 }}>{f}</label>
              <select
                value={mapping[f] ?? ""}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [f]: e.target.value }))
                }
              >
                <option value="">— not mapped —</option>
                {preview.detectedColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {preview.unmappedColumns.length > 0 && (
            <p>Unmapped columns: {preview.unmappedColumns.join(", ")}</p>
          )}

          <h3>Preview (first 20 rows)</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  {preview.detectedColumns.map((c) => (
                    <th key={c} style={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((r, i) => (
                  <tr key={i}>
                    {preview.detectedColumns.map((c) => (
                      <td key={c} style={td}>
                        {String(r[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>3. Confirm Import</h2>
          <label>
            <input
              type="checkbox"
              checked={allowDuplicate}
              onChange={(e) => setAllowDuplicate(e.target.checked)}
            />{" "}
            Allow possible duplicate (re-import same file)
          </label>{" "}
          <button onClick={onConfirm} disabled={loading}>
            {loading ? "Importing…" : "Confirm & Import"}
          </button>
        </div>
      )}

      {summary && (
        <div style={card}>
          <h2>Import Summary</h2>
          <p>File: {summary.file}</p>
          <p>Total Rows: {summary.totalRows}</p>
          <p>Imported: {summary.imported}</p>
          <p>Skipped: {summary.skipped}</p>
          <p>Failed: {summary.failed}</p>
          <p>Total Debit: {summary.totalDebit}</p>
          <p>Total Credit: {summary.totalCredit}</p>
          {summary.dateRange && (
            <p>
              Date Range: {summary.dateRange.min.slice(0, 10)} →{" "}
              {summary.dateRange.max.slice(0, 10)}
            </p>
          )}
          {summary.warnings.map((w) => (
            <p key={w} style={{ color: "#a60" }}>
              Warning: {w}
            </p>
          ))}
          {summary.rowErrors.map((r) => (
            <p key={`${r.rowIndex}-${r.message}`} style={{ color: "red" }}>
              Row {r.rowIndex}: {r.message}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
