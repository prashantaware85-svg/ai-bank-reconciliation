import { ApiRequestError, readRequestId } from "./api-errors";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface ApiError {
  message?: string | string[];
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? `Request failed (${res.status})`);
    throw new ApiRequestError(message, res.status, readRequestId(res.headers));
  }
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiRequestError(
      `Request failed (${res.status})`,
      res.status,
      readRequestId(res.headers),
    );
  }
  return (await res.json()) as T;
}

async function apiWithBody<T>(
  method: string,
  path: string,
  body: unknown,
  accessToken: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? `Request failed (${res.status})`);
    throw new ApiRequestError(message, res.status, readRequestId(res.headers));
  }
  return (await res.json()) as T;
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  accessToken: string,
): Promise<T> {
  return apiWithBody<T>("PATCH", path, body, accessToken);
}

export async function apiDelete<T>(
  path: string,
  accessToken: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiError;
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? `Request failed (${res.status})`);
    throw new ApiRequestError(message, res.status, readRequestId(res.headers));
  }
  return (await res.json()) as T;
}

/**
 * Authenticated file download (reports export). Uses the JWT in the
 * Authorization header (kept out of URLs/logs) and triggers a browser
 * download from the response blob. No hardcoded hosts — API_URL only.
 */
export async function downloadFile(
  path: string,
  filename: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiRequestError(
      `Download failed (${res.status})`,
      res.status,
      readRequestId(res.headers),
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
