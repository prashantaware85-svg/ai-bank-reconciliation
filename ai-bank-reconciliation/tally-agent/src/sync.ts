import type { AgentTransaction } from './adapter.js';

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

async function backendFetch(
  backendUrl: string,
  jwt: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${backendUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new BackendError('Backend did not respond in time');
    }
    throw new BackendError(
      'Cannot reach the backend — check BACKEND_URL',
    );
  }
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(', ')
      : (data.message ?? `Backend request failed (${res.status})`);
    throw new BackendError(message, res.status);
  }
  return data;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof BackendError) {
    return error.status === undefined || error.status >= 500;
  }
  return false;
}

/** Retry temporary backend failures with backoff; fail fast otherwise. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 1000,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isRetryable(error) || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

export interface SyncParams {
  tallyCompany: string;
  bankLedger: string;
  fromDate?: string;
  toDate?: string;
}

export async function fetchSync(
  backendUrl: string,
  jwt: string,
  syncId: string,
  timeoutMs: number,
): Promise<SyncParams & { status: string }> {
  const data = (await backendFetch(
    backendUrl,
    jwt,
    `/tally/sync/${syncId}`,
    { method: 'GET' },
    timeoutMs,
  )) as SyncParams & { status: string };
  return data;
}

export async function ingestBatch(
  backendUrl: string,
  jwt: string,
  syncId: string,
  transactions: AgentTransaction[],
  done: boolean,
  timeoutMs: number,
): Promise<unknown> {
  return withRetry(() =>
    backendFetch(
      backendUrl,
      jwt,
      `/tally/sync/${syncId}/ingest`,
      { method: 'POST', body: JSON.stringify({ transactions, done }) },
      timeoutMs,
    ),
  );
}

export async function reportFailure(
  backendUrl: string,
  jwt: string,
  syncId: string,
  errorMessage: string,
  timeoutMs: number,
): Promise<unknown> {
  return backendFetch(
    backendUrl,
    jwt,
    `/tally/sync/${syncId}/fail`,
    { method: 'PATCH', body: JSON.stringify({ errorMessage }) },
    timeoutMs,
  );
}
