import { describe, expect, it } from 'vitest';
import {
  BACKUP_CRIT_HOURS,
  BACKUP_WARN_HOURS,
  DRILL_COUNT_TABLES,
  evaluateBackupAge,
  evaluateRestoreVerification,
  isValidScratchName,
  MIGRATIONS_TABLE,
  scanDumpText,
  validateDump,
} from './backup-restore.js';

describe('backup/restore drill policy (Step 18)', () => {
  it('accepts safe scratch names and rejects the source/system/unsafe names', () => {
    expect(isValidScratchName('restore_drill_20261006', 'bank_reconciliation')).toBe(true);
    expect(isValidScratchName('bank_reconciliation', 'bank_reconciliation')).toBe(false);
    expect(isValidScratchName('BANK_RECONCILIATION', 'bank_reconciliation')).toBe(false);
    for (const bad of ['postgres', 'template0', 'template1', '1abc', 'has space', 'has"quote', 'a'.repeat(64), '']) {
      expect(isValidScratchName(bad, 'bank_reconciliation')).toBe(false);
    }
  });

  it('validates dumps as non-empty and parseable', () => {
    expect(
      validateDump({ bytes: 1024, restoreListExitCode: 0, restoreListEntries: 42 }).ok,
    ).toBe(true);
    expect(validateDump({ bytes: 0, restoreListExitCode: 0, restoreListEntries: 42 }).ok).toBe(false);
    expect(validateDump({ bytes: 10, restoreListExitCode: 1, restoreListEntries: 0 }).ok).toBe(false);
    expect(validateDump({ bytes: 10, restoreListExitCode: 0, restoreListEntries: 0 }).ok).toBe(false);
  });

  it('passes verification only when counts match and migrations exist', () => {
    const base = {
      source: { User: 0, AIAnalysis: 0, AuditLog: 0 },
      restored: { User: 0, AIAnalysis: 0, AuditLog: 0 },
      migrationsRows: 5,
    };
    expect(evaluateRestoreVerification(base)).toEqual({ ok: true, failures: [] });
    const mismatch = evaluateRestoreVerification({
      ...base,
      restored: { User: 1, AIAnalysis: 0, AuditLog: 0 },
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.failures.join(';')).toContain('"User" count mismatch');
    expect(
      evaluateRestoreVerification({ ...base, migrationsRows: 0 }).failures.join(';'),
    ).toContain(MIGRATIONS_TABLE);
    expect(DRILL_COUNT_TABLES).toContain('User');
  });

  it('flags secret shapes in dump text using fake values only', () => {
    expect(scanDumpText('plain narration NEFT ABC TRADERS')).toEqual([]);
    expect(scanDumpText('AI_API_KEY=FAKE-VALUE-HERE')).toContain('AI_API_KEY assignment');
    expect(scanDumpText('key sk-FAKEFAKEFAKEFAKEFAKE12 here')).toContain('OpenAI key shape');
    expect(scanDumpText('JWT_SECRET=FAKE-SECRET-abc')).toContain('JWT secret assignment');
    expect(
      scanDumpText('conn postgres://fake-user:fake-pass@host/db'),
    ).toContain('postgres URL with credentials');
    expect(scanDumpText('-----BEGIN FAKE PRIVATE KEY-----')).toContain('private key block');
  });

  it('evaluates backup freshness with warn/critical/missing states', () => {
    const now = '2026-10-08T12:00:00.000Z';
    expect(BACKUP_WARN_HOURS).toBe(26);
    expect(BACKUP_CRIT_HOURS).toBe(50);
    expect(
      evaluateBackupAge({ latestBackupAtIso: '2026-10-08T06:00:00.000Z', nowIso: now }).status,
    ).toBe('ok');
    expect(
      evaluateBackupAge({ latestBackupAtIso: '2026-10-07T06:00:00.000Z', nowIso: now }).status,
    ).toBe('warn');
    expect(
      evaluateBackupAge({ latestBackupAtIso: '2026-10-06T06:00:00.000Z', nowIso: now }).status,
    ).toBe('critical');
    expect(
      evaluateBackupAge({ latestBackupAtIso: null, nowIso: now }),
    ).toEqual({ status: 'missing', ageHours: null });
    expect(
      evaluateBackupAge({ latestBackupAtIso: 'not-a-date', nowIso: now }).status,
    ).toBe('missing');
    const custom = evaluateBackupAge({
      latestBackupAtIso: '2026-10-08T06:00:00.000Z',
      nowIso: now,
      warnHours: 5,
      critHours: 7,
    });
    expect(custom.status).toBe('warn');
    expect(custom.ageHours).toBeCloseTo(6, 5);
  });
});
