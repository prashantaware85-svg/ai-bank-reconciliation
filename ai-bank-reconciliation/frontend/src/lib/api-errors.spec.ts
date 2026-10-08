/**
 * Step 19 tests: failed responses surface a validated Request ID,
 * successes stay clean, and secrets/hostile values never reach the UI.
 *
 * Run with the workspace vitest runner (frontend has no test deps of
 * its own by design): from backend/, `npx vitest run
 * ../frontend/src/lib/api-errors.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  isSafeRequestId,
  readRequestId,
  toDisplayError,
} from "./api-errors";
import { apiGet, apiPost } from "./api";

function headersOf(id: string | null) {
  return {
    get: (name: string) =>
      name === "X-Request-Id" ? id : null,
  };
}

function failedResponse(id: string | null, message = "Unauthorized") {
  return {
    ok: false,
    status: 401,
    headers: headersOf(id),
    json: async () => ({ message }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("failed API response with X-Request-Id", () => {
  it("apiPost attaches the validated request ID with the server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failedResponse("corr-test-42")),
    );
    const err = await apiPost("/x", {}, "token").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).requestId).toBe("corr-test-42");
    expect((err as ApiRequestError).status).toBe(401);
    expect(toDisplayError(err)).toEqual({
      message: "Unauthorized",
      requestId: "corr-test-42",
    });
  });

  it("apiGet attaches the validated request ID with its status message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failedResponse("corr-test-43")),
    );
    const err = await apiGet("/x", "token").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).requestId).toBe("corr-test-43");
    expect(toDisplayError(err)).toEqual({
      message: "Request failed (401)",
      requestId: "corr-test-43",
    });
  });
});

describe("failed API response without X-Request-Id", () => {
  it("keeps the message and omits the support reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failedResponse(null)),
    );
    const err = await apiGet("/x", "token").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).requestId).toBeUndefined();
    expect(toDisplayError(err)).toEqual({ message: "Request failed (401)" });
  });
});

describe("successful API responses", () => {
  it("resolve without any error object or request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: headersOf("corr-success-1"),
        json: async () => ({ ok: true }),
      })),
    );
    await expect(apiGet("/x", "token")).resolves.toEqual({ ok: true });
    await expect(apiPost("/x", {}, "token")).resolves.toEqual({ ok: true });
  });
});

describe("secret values are never displayed", () => {
  it("rejects hostile or secret-shaped header values", () => {
    // Note: an `sk-…`-shaped value is syntactically a safe token and the
    // server only ever emits generated IDs, so shape-validation accepts
    // it; what must never happen is emitting tokens/bodies/headers, which
    // the layers below structurally exclude.
    for (const hostile of [
      "Bearer FAKE-JWT-VALUE",
      "../escape",
      "has spaces",
      "x".repeat(129),
      "",
    ]) {
      expect(isSafeRequestId(hostile)).toBe(false);
      expect(readRequestId(headersOf(hostile))).toBeUndefined();
      const err = new ApiRequestError("Unauthorized", 401, hostile);
      expect(err.requestId).toBeUndefined();
      if (hostile) {
        expect(JSON.stringify(toDisplayError(err))).not.toContain(hostile.slice(0, 20));
      }
    }
    expect(readRequestId(undefined)).toBeUndefined();
    expect(readRequestId(null)).toBeUndefined();
    expect(readRequestId({} as never)).toBeUndefined();
  });

  it("renders plain errors and strings without inventing references", () => {
    expect(toDisplayError(new Error("Login failed"))).toEqual({
      message: "Login failed",
    });
    expect(toDisplayError("Passwords do not match")).toEqual({
      message: "Passwords do not match",
    });
    expect(toDisplayError(null)).toEqual({ message: "Request failed" });
  });
});
