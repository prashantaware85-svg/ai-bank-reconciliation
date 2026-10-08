export interface AgentConfig {
  tallyBaseUrl: string;
  tallyTimeoutMs: number;
  backendUrl: string;
  backendJwt: string;
}


/**
 * Resolve the TallyPrime base URL. TALLY_BASE_URL wins when set; otherwise
 * it is assembled from TALLY_HOST (default 127.0.0.1) and TALLY_PORT
 * (default 9000) for production-style configuration.
 */
export function resolveTallyBaseUrl(env: NodeJS.ProcessEnv): string {
  const direct = env['TALLY_BASE_URL'];
  if (direct && direct.trim() !== '') return direct.replace(/\/$/, '');
  const host = (env['TALLY_HOST'] ?? '127.0.0.1').trim() || '127.0.0.1';
  const portRaw = (env['TALLY_PORT'] ?? '9000').trim() || '9000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid TALLY_PORT "${portRaw}" (expected 1-65535)`);
  }
  return `http://${host}:${port}`;
}

/** Backend JWT is required only for commands that push to the backend. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: { requireBackendJwt?: boolean } = {},
): AgentConfig {
  const backendJwt = env['BACKEND_JWT'] ?? '';
  if (opts.requireBackendJwt !== false && !backendJwt) {
    throw new Error('Missing required config: BACKEND_JWT');
  }
  return {
    tallyBaseUrl: resolveTallyBaseUrl(env),
    tallyTimeoutMs: Number(env['TALLY_TIMEOUT_MS'] ?? 20000),
    backendUrl: (env['BACKEND_URL'] ?? 'http://127.0.0.1:3001').replace(
      /\/$/,
      '',
    ),
    backendJwt,
  };
}

/** Tally-only commands (check/companies/ledgers/vouchers) skip JWT. */
export function loadTallyConfig(env: NodeJS.ProcessEnv = process.env): {
  tallyBaseUrl: string;
  tallyTimeoutMs: number;
} {
  return {
    tallyBaseUrl: resolveTallyBaseUrl(env),
    tallyTimeoutMs: Number(env['TALLY_TIMEOUT_MS'] ?? 20000),
  };
}
