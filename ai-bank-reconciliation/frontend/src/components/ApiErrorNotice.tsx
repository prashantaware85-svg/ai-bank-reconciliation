"use client";

import { toDisplayError } from "@/lib/api-errors";

/**
 * Step 19: non-intrusive API error display with a support reference.
 * Shows the server message (as before) plus a muted "Request ID: <id>"
 * line only when a validated correlation ID is present. Never renders
 * tokens, bodies, or unvalidated header values.
 */
export function ApiErrorNotice({
  error,
  color = "red",
}: {
  error: unknown;
  color?: string;
}) {
  const { message, requestId } = toDisplayError(error);
  if (!message) return null;
  return (
    <>
      <p style={{ color }}>{message}</p>
      {requestId ? (
        <p style={{ color: "#666", fontSize: "0.85em" }}>
          Request ID: {requestId}
        </p>
      ) : null}
    </>
  );
}
