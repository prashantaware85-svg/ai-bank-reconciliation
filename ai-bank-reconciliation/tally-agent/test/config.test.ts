import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  loadTallyConfig,
  resolveTallyBaseUrl,
} from '../src/config.js';

describe('resolveTallyBaseUrl', () => {
  it('prefers TALLY_BASE_URL when set', () => {
    expect(
      resolveTallyBaseUrl({
        TALLY_BASE_URL: 'http://tally-lan:9001/',
        TALLY_HOST: 'other',
        TALLY_PORT: '9002',
      } as NodeJS.ProcessEnv),
    ).toBe('http://tally-lan:9001');
  });

  it('assembles host + port with defaults', () => {
    expect(resolveTallyBaseUrl({} as NodeJS.ProcessEnv)).toBe(
      'http://127.0.0.1:9000',
    );
    expect(
      resolveTallyBaseUrl({
        TALLY_HOST: '192.168.1.50',
        TALLY_PORT: '9000',
      } as NodeJS.ProcessEnv),
    ).toBe('http://192.168.1.50:9000');
  });

  it('rejects invalid ports', () => {
    expect(() =>
      resolveTallyBaseUrl({ TALLY_PORT: 'abc' } as NodeJS.ProcessEnv),
    ).toThrow(/TALLY_PORT/);
    expect(() =>
      resolveTallyBaseUrl({ TALLY_PORT: '70000' } as NodeJS.ProcessEnv),
    ).toThrow(/TALLY_PORT/);
  });
});

describe('loadConfig', () => {
  it('requires BACKEND_JWT unless opted out', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(
      /BACKEND_JWT/,
    );
    const cfg = loadConfig(
      { BACKEND_JWT: 'jwt', TALLY_HOST: 'h', TALLY_PORT: '9000' } as NodeJS.ProcessEnv,
      { requireBackendJwt: true },
    );
    expect(cfg.tallyBaseUrl).toBe('http://h:9000');
  });

  it('loadTallyConfig skips JWT for local-only commands', () => {
    const cfg = loadTallyConfig({} as NodeJS.ProcessEnv);
    expect(cfg.tallyBaseUrl).toBe('http://127.0.0.1:9000');
    expect(cfg.tallyTimeoutMs).toBe(20000);
  });
});
