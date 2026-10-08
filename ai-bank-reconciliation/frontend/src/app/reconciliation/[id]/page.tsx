"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Fragment } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { ApiErrorNotice } from "@/components/ApiErrorNotice";
import { getAccessToken } from "@/lib/companies";

interface ReviewHistoryItem {
  id: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  comment: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface ReviewData {
  resultId: string;
  matchStatus: string;
  reviewStatus: string;
  reviewVersion: number;
  lastReviewedBy: string | null;
  lastReviewedAt: string | null;
  availableActions: string[];
  reviewHistory: ReviewHistoryItem[];
  aiAnalysis: {
    classification: string;
    aiConfidence: string | number;
    riskLevel: string;
    recommendedAction: string | null;
  } | null;
}

interface AiEvidenceItem {
  field: string;
  bankValue: string | null;
  tallyValue: string | null;
  finding: string;
}

interface AiAnalysis {
  id: string;
  classification: string;
  aiConfidence: string | number;
  riskLevel: string;
  reason: string;
  evidence?: {
    items?: AiEvidenceItem[];
    fuzzy?: Record<string, number>;
    providerError?: string;
  } | null;
  recommendedAction?: string | null;
  provider: string;
  model: string;
  deterministicConfidence?: number | null;
}

interface RunDetail {
  id: string;
  status: string;
  fromDate: string;
  toDate: string;
  totalBankTransactions: number;
  totalTallyTransactions: number;
  matchedCount: number;
  possibleMatchCount: number;
  unmatchedCount: number;
  exceptionCount: number;
  reviewSummary?: {
    pendingReview: number;
    inReview: number;
    confirmed: number;
    rejected: number;
    ignored: number;
    wrongParty: number;
    duplicate: number;
    amountMismatch: number;
    dateMismatch: number;
    missingInTally: number;
    missingInBank: number;
  };
  aiSummary?: {
    byClassification: Record<string, number>;
    byRisk: Record<string, number>;
  };
}

interface Txn {
  id: string;
  transactionDate?: string;
  date?: string;
  narration?: string;
  description?: string;
  reference?: string;
  party?: string;
  ledger?: string;
  voucherNo?: string;
  voucherType?: string;
  debit?: string;
  credit?: string;
  amount: string;
}

interface Result {
  id: string;
  matchStatus: string;
  matchType?: string;
  bankTotal?: string | null;
  tallyTotal?: string | null;
  confidence: number | null;
  amountDifference: string | null;
  dateDifferenceDays: number | null;
  matchReason: string | null;
  evidence: Record<string, string> | null;
  bankTransaction: Txn | null;
  tallyTransaction: Txn | null;
  links?: {
    side: string;
    bankTransaction: Txn | null;
    tallyTransaction: Txn | null;
  }[];
}

const bankLinks = (r: Result) =>
  (r.links ?? []).filter((l) => l.side === "BANK" && l.bankTransaction);
const tallyLinks = (r: Result) =>
  (r.links ?? []).filter((l) => l.side === "TALLY" && l.tallyTransaction);

const STATUSES = [
  "",
  "MATCHED",
  "POSSIBLE_MATCH",
  "UNMATCHED",
  "AMOUNT_MISMATCH",
  "DATE_MISMATCH",
  "MISSING_IN_TALLY",
  "MISSING_IN_BANK",
  "REVIEW_REQUIRED",
];

const MATCH_TYPES = [
  "",
  "ONE_TO_ONE",
  "ONE_TO_MANY",
  "MANY_TO_ONE",
  "DUPLICATE_CANDIDATE",
];

const REVIEW_STATUSES = [
  "PENDING_REVIEW",
  "IN_REVIEW",
  "CONFIRMED_MATCH",
  "WRONG_PARTY",
  "DUPLICATE_CONFIRMED",
  "AMOUNT_MISMATCH_CONFIRMED",
  "DATE_MISMATCH_CONFIRMED",
  "MISSING_IN_TALLY_CONFIRMED",
  "MISSING_IN_BANK_CONFIRMED",
  "REJECTED",
  "IGNORED",
  "CORRECTION_REQUIRED",
];

const ACTION_LABELS: Record<string, string> = {
  START_REVIEW: "Start Review",
  CONFIRM_MATCH: "Confirm Match",
  CONFIRM_WRONG_PARTY: "Confirm Wrong Party",
  CONFIRM_DUPLICATE: "Confirm Duplicate",
  CONFIRM_AMOUNT_MISMATCH: "Confirm Amount Mismatch",
  CONFIRM_DATE_MISMATCH: "Confirm Date Mismatch",
  CONFIRM_MISSING_IN_TALLY: "Confirm Missing in Tally",
  CONFIRM_MISSING_IN_BANK: "Confirm Missing in Bank",
  REJECT: "Reject",
  IGNORE: "Ignore",
  REOPEN: "Reopen",
};

const COMMENT_REQUIRED_ACTIONS = new Set([
  "CONFIRM_WRONG_PARTY",
  "CONFIRM_DUPLICATE",
  "CONFIRM_AMOUNT_MISMATCH",
  "CONFIRM_DATE_MISMATCH",
  "CONFIRM_MISSING_IN_TALLY",
  "CONFIRM_MISSING_IN_BANK",
  "REJECT",
  "IGNORE",
]);

const wrap: React.CSSProperties = {
  maxWidth: 1100,
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
const input: React.CSSProperties = { padding: 6, margin: "4px 8px 4px 0" };

export default function ReconciliationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [matchType, setMatchType] = useState("");
  const [party, setParty] = useState("");
  const [reference, setReference] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ai, setAi] = useState<Record<string, AiAnalysis | null>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<unknown>(null);
  const [review, setReview] = useState<Record<string, ReviewData | null>>({});
  const [reviewComment, setReviewComment] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<unknown>(null);
  const [reviewStatusFilter, setReviewStatusFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");

  function load(query = "") {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiGet<RunDetail>(`/reconciliation/runs/${id}`, token)
      .then(setRun)
      .catch((err: Error) => setError(err));
    apiGet<{ total: number; rows: Result[] }>(
      `/reconciliation/runs/${id}/results?limit=100${query}`,
      token,
    )
      .then((d) => {
        setResults(d.rows);
        setTotal(d.total);
      })
      .catch((err: Error) => setError(err));
  }

  function loadReview(resultId: string) {
    const token = getAccessToken();
    if (!token) return;
    apiGet<ReviewData>(`/reconciliation/results/${resultId}/review`, token)
      .then((r) => setReview((m) => ({ ...m, [resultId]: r })))
      .catch(() => {});
  }

  async function doReview(resultId: string, action: string) {
    setReviewBusy(resultId);
    setReviewError(null);
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    try {
      await apiPost(
        `/reconciliation/results/${resultId}/review`,
        {
          action,
          comment: reviewComment[resultId] || undefined,
          reviewVersion: review[resultId]?.reviewVersion,
        },
        token,
      );
      loadReview(resultId);
      load();
    } catch (err) {
      setReviewError(err instanceof Error ? err : "Review failed");
    } finally {
      setReviewBusy(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function analyzeWithAi(resultId: string) {
    setAiBusy(resultId);
    setAiError(null);
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    try {
      const outcome = await apiPost<{ cached: boolean; analysis: AiAnalysis }>(
        `/reconciliation/results/${resultId}/analyze`,
        {},
        token,
      );
      setAi((m) => ({ ...m, [resultId]: outcome.analysis }));
    } catch (err) {
      setAiError(err instanceof Error ? err : "AI analysis failed");
    } finally {
      setAiBusy(null);
    }
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const q =
      `${status ? `&status=${status}` : ""}` +
      `${matchType ? `&matchType=${matchType}` : ""}` +
      `${reviewStatusFilter ? `&reviewStatus=${reviewStatusFilter}` : ""}` +
      `${riskFilter ? `&risk=${riskFilter}` : ""}` +
      `${party ? `&party=${encodeURIComponent(party)}` : ""}` +
      `${reference ? `&reference=${encodeURIComponent(reference)}` : ""}`;
    load(q);
  }

  if (error && !run) {
    return (
      <main style={wrap}>
        <ApiErrorNotice error={error} />
        <Link href="/reconciliation">Back to runs</Link>
      </main>
    );
  }
  if (!run) return <main style={wrap}>Loading…</main>;

  return (
    <main style={wrap}>
      <Link href="/reconciliation">← Runs</Link>
      <h1>Reconciliation Result</h1>
      <div style={card}>
        <p>
          Period: {run.fromDate.slice(0, 10)} → {run.toDate.slice(0, 10)} —
          Status: {run.status}
        </p>
        <p>Total Bank Transactions: {run.totalBankTransactions}</p>
        <p>Total Tally Transactions: {run.totalTallyTransactions}</p>
        <p>Matched: {run.matchedCount}</p>
        <p>Possible Match: {run.possibleMatchCount}</p>
        <p>Unmatched: {run.unmatchedCount}</p>
        <p>Amount Mismatch: counted in exceptions</p>
        <p>Date Mismatch: counted in exceptions</p>
        <p>Missing in Tally / Missing in Bank: counted in exceptions</p>
        <p>Review Required: counted in exceptions</p>
        <p>Exceptions total: {run.exceptionCount}</p>
        {run.reviewSummary && (
          <>
            <p>
              Pending Review: {run.reviewSummary.pendingReview} — In Review:{" "}
              {run.reviewSummary.inReview}
            </p>
            <p>
              Confirmed: {run.reviewSummary.confirmed} — Wrong Party:{" "}
              {run.reviewSummary.wrongParty} — Duplicate:{" "}
              {run.reviewSummary.duplicate}
            </p>
            <p>
              Amount Mismatch Confirmed: {run.reviewSummary.amountMismatch} —
              Date Mismatch Confirmed: {run.reviewSummary.dateMismatch}
            </p>
            <p>
              Missing in Tally: {run.reviewSummary.missingInTally} — Missing in
              Bank: {run.reviewSummary.missingInBank}
            </p>
            <p>
              Rejected: {run.reviewSummary.rejected} — Ignored:{" "}
              {run.reviewSummary.ignored}
            </p>
          </>
        )}
        {run.aiSummary &&
          Object.keys(run.aiSummary.byClassification).length > 0 && (
            <p>
              AI:{" "}
              {Object.entries(run.aiSummary.byClassification)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")}{" "}
              — Risk:{" "}
              {Object.entries(run.aiSummary.byRisk)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")}
            </p>
          )}
        <p>
          <Link href="/party-aliases">Party Aliases</Link>
        </p>
      </div>

      <div style={card}>
        <h2>Filters ({total} results)</h2>
        <form onSubmit={applyFilters}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={input}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </select>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value)}
            style={input}
          >
            {MATCH_TYPES.map((t) => (
              <option key={t} value={t}>
                {t || "All match types"}
              </option>
            ))}
          </select>
          <input
            style={input}
            placeholder="party"
            value={party}
            onChange={(e) => setParty(e.target.value)}
          />
          <input
            style={input}
            placeholder="reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <select
            value={reviewStatusFilter}
            onChange={(e) => setReviewStatusFilter(e.target.value)}
            style={input}
          >
            <option value="">All review statuses</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            style={input}
          >
            <option value="">All risks</option>
            {["LOW", "MEDIUM", "HIGH"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit">Apply</button>
        </form>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Bank Amount</th>
              <th style={th}>Tally Amount</th>
              <th style={th}>Status</th>
              <th style={th}>Match Type</th>
              <th style={th}>Confidence</th>
              <th style={th}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <Fragment key={r.id}>
                <tr
                  onClick={() => {
                    const next = open === r.id ? null : r.id;
                    setOpen(next);
                    if (next) loadReview(r.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td style={td}>
                    {r.matchType === "ONE_TO_MANY"
                      ? (r.bankTotal ?? r.bankTransaction?.amount ?? "—")
                      : r.bankTransaction?.amount ?? "—"}
                  </td>
                  <td style={td}>
                    {r.matchType === "ONE_TO_MANY"
                      ? (r.tallyTotal ?? "—")
                      : r.tallyTransaction?.amount ?? "—"}
                  </td>
                  <td style={td}>{r.matchStatus}</td>
                  <td style={td}>{r.matchType ?? "ONE_TO_ONE"}</td>
                  <td style={td}>{r.confidence ?? "—"}</td>
                  <td style={td}>{r.matchReason ?? "—"}</td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td style={td} colSpan={6}>
                      {r.matchType === "ONE_TO_MANY" && (
                        <>
                          <strong>BANK:</strong> {r.bankTotal ?? "—"} (1 txn)
                          <br />
                          <strong>TALLY:</strong>{" "}
                          {tallyLinks(r)
                            .map((l) => {
                              const t = l.tallyTransaction;
                              return `${t?.date?.slice(0, 10) ?? "—"} — ${t?.party ?? "—"} — ${t?.amount ?? "—"}`;
                            })
                            .join(" | ") || r.tallyTotal}
                          <br />
                          <strong>Total:</strong> {r.tallyTotal ?? "—"} —{" "}
                          <strong>Status:</strong> {r.matchStatus} —{" "}
                          <strong>Match Type:</strong> ONE TO MANY
                          <br />
                        </>
                      )}
                      {r.matchType === "MANY_TO_ONE" && (
                        <>
                          <strong>BANK:</strong>{" "}
                          {bankLinks(r)
                            .map((l) => {
                              const b = l.bankTransaction;
                              return `${b?.transactionDate?.slice(0, 10) ?? "—"} — ${b?.narration ?? "—"} — ${b?.amount ?? "—"}`;
                            })
                            .join(" | ") || r.bankTotal}
                          <br />
                          <strong>TALLY:</strong> {r.tallyTotal ?? "—"} (1
                          voucher)
                          <br />
                          <strong>Total:</strong> {r.bankTotal ?? "—"} —{" "}
                          <strong>Status:</strong> {r.matchStatus} —{" "}
                          <strong>Match Type:</strong> MANY TO ONE
                          <br />
                        </>
                      )}
                      {r.matchType === "DUPLICATE_CANDIDATE" && (
                        <>
                          <strong>Transaction(s):</strong>{" "}
                          {[
                            ...bankLinks(r).map((l) => {
                              const b = l.bankTransaction;
                              return `${b?.transactionDate?.slice(0, 10) ?? "—"} — ${b?.narration ?? "—"} — ${b?.amount ?? "—"}`;
                            }),
                            ...tallyLinks(r).map((l) => {
                              const t = l.tallyTransaction;
                              return `${t?.date?.slice(0, 10) ?? "—"} — ${t?.party ?? "—"} — ${t?.amount ?? "—"}`;
                            }),
                          ].join(" | ")}
                          <br />
                          <strong>Possible Duplicate:</strong> review required
                          — nothing was merged or deleted
                          <br />
                        </>
                      )}
                      {(!r.matchType || r.matchType === "ONE_TO_ONE") && (
                        <>
                          <strong>Bank side:</strong> Date{" "}
                          {r.bankTransaction?.transactionDate?.slice(0, 10) ??
                            "—"}
                          , Narration {r.bankTransaction?.narration ?? "—"},
                          Reference {r.bankTransaction?.reference ?? "—"},
                          Debit {r.bankTransaction?.debit ?? "—"}, Credit{" "}
                          {r.bankTransaction?.credit ?? "—"}, Amount{" "}
                          {r.bankTransaction?.amount ?? "—"}
                          <br />
                          <strong>Tally side:</strong> Date{" "}
                          {r.tallyTransaction?.date?.slice(0, 10) ?? "—"},
                          Voucher {r.tallyTransaction?.voucherNo ?? "—"} (
                          {r.tallyTransaction?.voucherType ?? "—"}), Party{" "}
                          {r.tallyTransaction?.party ?? "—"}, Ledger{" "}
                          {r.tallyTransaction?.ledger ?? "—"}, Reference{" "}
                          {r.tallyTransaction?.reference ?? "—"}, Amount{" "}
                          {r.tallyTransaction?.amount ?? "—"}
                          <br />
                        </>
                      )}
                      <strong>Match evidence:</strong>{" "}
                      {r.evidence
                        ? Object.entries(r.evidence)
                            .filter(
                              ([k]) =>
                                ![
                                  "matchType",
                                  "bankTransactionIds",
                                  "tallyTransactionIds",
                                  "bankTotal",
                                  "tallyTotal",
                                ].includes(k),
                            )
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(", ")
                        : "—"}
                      <br />
                      <strong>Reason:</strong> {r.matchReason ?? "—"}
                      <br />
                      <strong>AI Analysis</strong>{" "}
                      {ai[r.id] ? (
                        <>
                          <br />
                          <strong>Classification:</strong>{" "}
                          {ai[r.id]?.classification ===
                          "WRONG_PARTY_CANDIDATE"
                            ? "Possible Wrong Party — accountant review required"
                            : (ai[r.id]?.classification ?? "—")}
                          <br />
                          <strong>Risk:</strong> {ai[r.id]?.riskLevel ?? "—"}
                          <br />
                          <strong>
                            AI Confidence:
                          </strong>{" "}
                          {Math.round(
                            Number(ai[r.id]?.aiConfidence ?? 0) * 100,
                          )}
                          % (deterministic:{" "}
                          {ai[r.id]?.deterministicConfidence ?? "—"})
                          <br />
                          <strong>Reason:</strong> {ai[r.id]?.reason}
                          <br />
                          <strong>Evidence:</strong>
                          {(ai[r.id]?.evidence?.items ?? []).map((e) => (
                            <span key={`${e.field}-${e.finding}`}>
                              {" "}
                              {e.field}: {e.finding};
                            </span>
                          ))}
                          {ai[r.id]?.evidence?.fuzzy && (
                            <span>
                              {" "}
                              similarity:{" "}
                              {Object.entries(
                                ai[r.id]?.evidence?.fuzzy ?? {},
                              )
                                .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
                                .join(", ")}
                            </span>
                          )}
                          <br />
                          <strong>Recommended Action:</strong>{" "}
                          {ai[r.id]?.recommendedAction ?? "—"}
                          {ai[r.id]?.evidence?.providerError && (
                            <>
                              <br />
                              <span style={{ color: "#a60" }}>
                                AI provider unavailable — deterministic
                                reconciliation result is still valid.
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => analyzeWithAi(r.id)}
                            disabled={aiBusy === r.id}
                          >
                            {aiBusy === r.id
                              ? "Analyzing…"
                              : "Analyze with AI"}
                          </button>
                        </>
                      )}
                      {aiError && aiBusy === null ? (
                        <ApiErrorNotice error={aiError} color="#a60" />
                      ) : null}
                      {ai[r.id] && (
                        <span style={{ color: "#a60" }}>
                          {" "}
                          AI recommendation — accountant decision required
                        </span>
                      )}
                      <br />
                      <strong>Review</strong>
                      <br />
                      <strong>Review Status:</strong>{" "}
                      {review[r.id]?.reviewStatus ?? "PENDING_REVIEW"} —{" "}
                      <strong>Reconciliation Status:</strong>{" "}
                      {r.matchStatus}
                      {review[r.id]?.lastReviewedBy && (
                        <span>
                          {" "}
                          (by {review[r.id]?.lastReviewedBy} at{" "}
                          {review[r.id]?.lastReviewedAt?.slice(0, 16)})
                        </span>
                      )}
                      <br />
                      {(review[r.id]?.availableActions ?? []).map((a) => (
                        <span key={a}>
                          <button
                            type="button"
                            onClick={() => doReview(r.id, a)}
                            disabled={reviewBusy === r.id}
                            style={{ margin: "4px 4px 4px 0" }}
                          >
                            {ACTION_LABELS[a] ?? a}
                          </button>{" "}
                        </span>
                      ))}
                      {(review[r.id]?.availableActions ?? []).length > 0 && (
                        <input
                          style={input}
                          placeholder={
                            "Comment" +
                            (review[r.id] &&
                            (review[r.id]?.availableActions ?? []).some((a) =>
                              COMMENT_REQUIRED_ACTIONS.has(a),
                            )
                              ? " (required for confirmations/reject/ignore)"
                              : " (optional)")
                          }
                          value={reviewComment[r.id] ?? ""}
                          onChange={(e) =>
                            setReviewComment((m) => ({
                              ...m,
                              [r.id]: e.target.value,
                            }))
                          }
                        />
                      )}
                      {reviewError && reviewBusy === null ? (
                        <ApiErrorNotice error={reviewError} />
                      ) : null}
                      {(review[r.id]?.reviewHistory ?? []).length > 0 && (
                        <>
                          <br />
                          <strong>Review History</strong>
                          {(review[r.id]?.reviewHistory ?? []).map((h) => (
                            <div key={h.id} style={{ margin: "4px 0" }}>
                              {h.createdAt.slice(0, 16).replace("T", " ")} —{" "}
                              {h.user?.name ?? "Unknown"} —{" "}
                              {ACTION_LABELS[h.action] ?? h.action}
                              {h.comment && (
                                <>
                                  {" "}
                                  — Comment: “{h.comment}”
                                </>
                              )}{" "}
                              — Previous: {h.previousStatus} → New:{" "}
                              {h.newStatus}
                            </div>
                          ))}
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
