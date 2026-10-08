/**
 * Backup/restore drill policy helpers (Step 18).
 *
 * Pure functions encoding the guardrails that the PowerShell drill
 * scripts (`database/Backup-Postgres.ps1`, `database/Restore-Verify.ps1`)
 * enforce: scratch-database naming, dump validity, restore verification,
 * and backup secret hygiene. Tested in `backup-restore.spec.ts`.
 */

/** Scratch databases must be unquoted-safe identifiers. */
export const SCRATCH_DB_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

/** Databases a drill must never create, drop, or restore into. */
const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1']);

/**
 * A scratch name is usable when it matches the safe pattern and is not
 * the source database (case-insensitive) nor a protected system database.
 */
export function isValidScratchName(
  scratchDb: string,
  sourceDb: string,
): boolean {
  if (!SCRATCH_DB_PATTERN.test(scratchDb)) return false;
  const lower = scratchDb.toLowerCase();
  if (lower === sourceDb.toLowerCase()) return false;
  return !PROTECTED_DATABASES.has(lower);
}

/** A dump is usable when it is non-empty and `pg_restore --list` parsed it. */
export function validateDump(input: {
  bytes: number;
  restoreListExitCode: number;
  restoreListEntries: number;
}): { ok: boolean; reason: string } {
  if (input.bytes <= 0) return { ok: false, reason: 'dump file is empty' };
  if (input.restoreListExitCode !== 0) {
    return { ok: false, reason: 'pg_restore --list failed to parse the dump' };
  }
  if (input.restoreListEntries <= 0) {
    return { ok: false, reason: 'dump contains no restorable entries' };
  }
  return { ok: true, reason: 'dump is non-empty and parses cleanly' };
}

/** Tables that must exist (with matching row counts) after a drill restore. */
export const DRILL_COUNT_TABLES = ['User', 'AIAnalysis', 'AuditLog'] as const;

/** Migration history must be present so the restored schema is proven current. */
export const MIGRATIONS_TABLE = '_prisma_migrations';

export interface RestoreCounts {
  source: Record<string, number>;
  restored: Record<string, number>;
  migrationsRows: number;
}

/** Compare source vs restored counts; every mismatch is reported. */
export function evaluateRestoreVerification(
  counts: RestoreCounts,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const table of DRILL_COUNT_TABLES) {
    const a = counts.source[table];
    const b = counts.restored[table];
    if (a === undefined || b === undefined) {
      failures.push(`missing count for "${table}"`);
    } else if (a !== b) {
      failures.push(`"${table}" count mismatch: source=${a} restored=${b}`);
    }
  }
  if (counts.migrationsRows <= 0) {
    failures.push(`"${MIGRATIONS_TABLE}" has no rows; schema state unproven`);
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Secret shapes that must never appear in a backup (names only — the
 * scan reports WHICH pattern hit, never the matched value). Matches the
 * PowerShell drill script scan; application secrets live in env files,
 * never in the database.
 */
export const DUMP_SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'AI_API_KEY assignment', pattern: /AI_API_KEY\s*=/ },
  { name: 'JWT secret assignment', pattern: /JWT_(?:REFRESH_)?SECRET\s*=/ },
  { name: 'OpenAI key shape', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'postgres URL with credentials', pattern: /postgres(?:ql)?:\/\/[^/\s:]+:[^/\s@]+@/ },
];

/** Return the names of secret patterns found in dump text (empty = clean). */
export function scanDumpText(text: string): string[] {
  return DUMP_SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}

/** Default stale-backup thresholds (hours); mirrors Check-BackupAge.ps1. */
export const BACKUP_WARN_HOURS = 26;
export const BACKUP_CRIT_HOURS = 50;

export type BackupAgeStatus = 'ok' | 'warn' | 'critical' | 'missing';

/**
 * Evaluate backup freshness for monitoring (Step 20). `latestBackupAtIso`
 * is null when no usable dump exists. Pure function — the PowerShell
 * monitor enforces the same thresholds.
 */
export function evaluateBackupAge(input: {
  latestBackupAtIso: string | null;
  nowIso: string;
  warnHours?: number;
  critHours?: number;
}): { status: BackupAgeStatus; ageHours: number | null } {
  const warn = input.warnHours ?? BACKUP_WARN_HOURS;
  const crit = input.critHours ?? BACKUP_CRIT_HOURS;
  if (!input.latestBackupAtIso) return { status: 'missing', ageHours: null };
  const ageMs =
    new Date(input.nowIso).getTime() - new Date(input.latestBackupAtIso).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { status: 'missing', ageHours: null };
  }
  const ageHours = ageMs / 3_600_000;
  if (ageHours >= crit) return { status: 'critical', ageHours };
  if (ageHours >= warn) return { status: 'warn', ageHours };
  return { status: 'ok', ageHours };
}
