
import { execSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '../bank-accounts/statement/statement-parser.js';
import { AiAnalysisController } from '../ai/ai-analysis.controller.js';
import { HealthController } from '../health/health.controller.js';
import { ReportsController } from '../reports/reports.controller.js';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '..', '..');
const rootDir = resolve(backendDir, '..');

function read(rel: string): string {
  return readFileSync(join(rootDir, rel), 'utf8');
}

function exists(rel: string): boolean {
  return existsSync(join(rootDir, rel));
}

// ---------------------------------------------------------------------------
// 1. Dockerfiles: syntax structure, non-root, no secrets baked in
// ---------------------------------------------------------------------------

describe('deployment: Dockerfiles', () => {
  const images = [
    'backend/Dockerfile',
    'frontend/Dockerfile',
    'tally-agent/Dockerfile',
  ];

  it.each(images)('%s exists with multi-stage pinned base', (file) => {
    expect(exists(file), `${file} must exist`).toBe(true);
    const content = read(file);
    const froms = content.match(/^FROM\s+\S+/gm) ?? [];
    // backend + frontend are multi-stage (≥2 FROM); agent build+runtime (≥2).
    expect(froms.length).toBeGreaterThanOrEqual(2);
    expect(content).toMatch(/FROM node:22-alpine/);
  });

  it.each(images)('%s runs as non-root and never copies .env', (file) => {
    const content = read(file);
    expect(content).toMatch(/^USER (node|nextjs)/m);
    expect(content).not.toMatch(/^COPY.*\.env(\s|$)/m);
    // Local node_modules must never be copied (multi-stage --from= is fine).
    expect(content).not.toMatch(/^COPY node_modules/m);
    expect(content).not.toMatch(/^COPY \. \/app/m);
  });

  it('backend image runs migrations safely then starts', () => {
    const dockerfile = read('backend/Dockerfile');
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/ENTRYPOINT/);
    const entrypoint = read('backend/docker-entrypoint.sh');
    expect(entrypoint).toMatch(/prisma migrate deploy/);
    expect(entrypoint).not.toMatch(/^\s*(npx\s+)?prisma\s+db\s+push\b/m);
    expect(entrypoint).not.toMatch(/\bprisma\s+migrate\s+reset\b/);
  });

  it('each service has a .dockerignore excluding secrets and build output', () => {
    for (const dir of ['backend', 'frontend', 'tally-agent']) {
      expect(exists(`${dir}/.dockerignore`), `${dir}/.dockerignore`).toBe(
        true,
      );
      const content = read(`${dir}/.dockerignore`);
      expect(content).toMatch(/node_modules/);
      expect(content).toMatch(/\.env/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2/3. Compose files: prod internal services, dev intact
// ---------------------------------------------------------------------------

describe('deployment: compose files', () => {
  it('dev compose is untouched and exposes local ports', () => {
    const content = read('docker-compose.yml');
    expect(content).toMatch(/postgres:16-alpine/);
    expect(content).toMatch(/redis:7-alpine/);
    expect(content).toMatch(/"5432:5432"/);
  });

  it('prod compose wires all four services with health-gated startup', () => {
    const content = read('docker-compose.prod.yml');
    for (const svc of ['postgres:', 'redis:', 'backend:', 'frontend:']) {
      expect(content).toContain(svc);
    }
    expect(content).toMatch(/condition: service_healthy/);
    expect(content).toMatch(/postgres-data:/);
    expect(content).toMatch(/redis-data:/);
  });

  it('prod postgres/redis publish no ports; backend is localhost-only', () => {
    const content = read('docker-compose.prod.yml');
    const lines = content.split('\n');
    let current = '';
    const portsByService = new Map<string, string[]>();
    for (const line of lines) {
      const svc = line.match(/^  (\w[\w-]*):\s*$/);
      if (svc?.[1]) {
        current = svc[1];
        continue;
      }
      const ports = line.match(/^\s{4}ports:\s*$/);
      if (ports && current) {
        const published: string[] = [];
        portsByService.set(current, published);
        continue;
      }
      const mapping = line.match(/^\s{6}-\s*"([^"]+)"/);
      if (mapping?.[1] && current && portsByService.has(current)) {
        portsByService.get(current)?.push(mapping[1]);
      }
    }
    expect(portsByService.get('postgres') ?? []).toEqual([]);
    expect(portsByService.get('redis') ?? []).toEqual([]);
    const backendPorts = portsByService.get('backend') ?? [];
    expect(backendPorts.length).toBeGreaterThan(0);
    for (const p of backendPorts) {
      expect(p.startsWith('127.0.0.1:')).toBe(true);
    }
  });

  it('prod credentials come from environment, never hardcoded', () => {
    const content = read('docker-compose.prod.yml');
    expect(content).toMatch(/\$\{POSTGRES_PASSWORD:\?/);
    expect(content).toMatch(/\$\{JWT_SECRET:\?/);
    expect(content).not.toMatch(/bankapp_secret/);
  });
});

// ---------------------------------------------------------------------------
// 7. .env.example placeholders only
// ---------------------------------------------------------------------------

describe('deployment: environment template', () => {
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'AI_PROVIDER',
    'AI_API_KEY',
    'AI_MODEL',
    'NODE_ENV',
    'PORT',
    'CORS_ORIGIN',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'NEXT_PUBLIC_API_URL',
  ];

  it('.env.example documents every required variable', () => {
    const content = read('.env.example');
    for (const key of required) {
      expect(content).toContain(`${key}=`);
    }
  });

  it('.env.example contains placeholders, never real secrets', () => {
    const content = read('.env.example');
    expect(content).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(content).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(content).not.toMatch(/[0-9a-f]{64}/);
  });
});

// ---------------------------------------------------------------------------
// 8/11. Upload limits + rate limits wired
// ---------------------------------------------------------------------------

describe('deployment: upload and rate limits', () => {
  it('bank statement uploads are capped at 10 MB in memory', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    const controller = read('backend/src/bank-accounts/bank-accounts.controller.ts');
    expect(controller).toMatch(/memoryStorage\(\)/);
    expect(controller).toMatch(/fileSize: MAX_FILE_BYTES/);
    expect(controller).not.toMatch(/diskStorage/);
  });

  it('ThrottlerGuard is global and AI/export routes are stricter', () => {
    // Metadata keys are `THROTTLER:LIMIT<name>` / `THROTTLER:TTL<name>`.
    const limitOf = (target: object, method: string): unknown =>
      Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        (target as Record<string, (...args: never[]) => unknown>)[method],
      );
    const ttlOf = (target: object, method: string): unknown =>
      Reflect.getMetadata(
        'THROTTLER:TTLdefault',
        (target as Record<string, (...args: never[]) => unknown>)[method],
      );

    // AI analysis: stronger protection (30/min).
    expect(limitOf(AiAnalysisController.prototype, 'analyze')).toBe(30);
    expect(ttlOf(AiAnalysisController.prototype, 'analyze')).toBe(60_000);
    // Report exports: 10/min.
    expect(
      limitOf(ReportsController.prototype, 'exportReconciliationXlsx'),
    ).toBe(10);
    expect(
      limitOf(ReportsController.prototype, 'exportReconciliationPdf'),
    ).toBe(10);
  });

  it('AppModule registers the global throttler guard', () => {
    // Static check (importing AppModule would run env validation at
    // module-evaluation time, which must fail without secrets configured).
    const source = read('backend/src/app.module.ts');
    expect(source).toMatch(/ThrottlerModule\.forRoot/);
    expect(source).toMatch(/provide:\s*APP_GUARD/);
    expect(source).toMatch(/useClass:\s*ThrottlerGuard/);
  });
});

// ---------------------------------------------------------------------------
// 4. Health routes exist with the right paths
// ---------------------------------------------------------------------------

describe('deployment: health routes', () => {
  it('exposes GET /health and GET /health/ready', async () => {
    const { PATH_METADATA, METHOD_METADATA } = await import(
      '@nestjs/common/constants.js'
    );
    const controllerPath = Reflect.getMetadata(
      PATH_METADATA,
      HealthController,
    ) as string;
    expect(controllerPath).toBe('health');
    const readyPath = Reflect.getMetadata(
      PATH_METADATA,
      HealthController.prototype['ready'],
    ) as string;
    expect(readyPath).toBe('ready');
    const readyMethod = Reflect.getMetadata(
      METHOD_METADATA,
      HealthController.prototype['ready'],
    ) as number;
    expect(readyMethod).toBe(0); // RequestMethod.GET
  });
});

// ---------------------------------------------------------------------------
// 12. No-secret repository scan
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'coverage',
  '.turbo',
  'out',
  'generated',
]);
const SKIP_FILES = new Set(['package-lock.json']);
const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.md',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (!SKIP_FILES.has(entry.name)) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      const base = entry.name.toLowerCase();
      if (
        SCAN_EXTENSIONS.has(ext) ||
        base === 'dockerfile' ||
        base.startsWith('dockerfile.') ||
        base === '.env' ||
        base === '.env.prod' ||
        base === '.env.local'
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

const PLACEHOLDER = /placeholder|example|changeme|change-me|your-|<[^>]*>|\$\{|test|fake|dummy|secret|password|xxx|none|null/i;

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'openai-key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'slack-token', re: /xox[bpas]-[A-Za-z0-9-]+/ },
  { name: 'github-token', re: /\b(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/ },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    name: 'jwt',
    re: /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{8,}/,
  },
  {
    name: 'postgres-url-password',
    re: /postgres(?:ql)?:\/\/[^/\s:]+:([^@\s$<{]{4,})@/,
  },
  {
    name: 'password-assignment',
    re: /(password|passwd|pwd)\s*[:=]\s*['"]([^'"]+)['"]/i,
  },
];

describe('deployment: no-secret repository scan', () => {
  it('finds no real secrets in tracked source files', () => {
    const files = walk(rootDir).filter((f) => {
      const base = f.split(/[\\/]/).pop() ?? '';
      if (f.endsWith('.spec.ts')) return false; // synthetic test fixtures
      if (f.endsWith('.example')) return false; // placeholders by definition
      // Local-only env files (backend/.env etc.): scanned by the
      // git-tracking test below, which proves they are untracked.
      if (/^\.env(\..+)?$/.test(base) && !base.endsWith('.example')) {
        return false;
      }
      return !f.includes(`${'node_modules'}/`);
    });
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const { name, re } of SECRET_PATTERNS) {
        const global = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
        let match: RegExpExecArray | null;
        while ((match = global.exec(content)) !== null) {
          const value = match[1] ?? match[0];
          if (PLACEHOLDER.test(value)) continue;
          // 64-hex sample strings in docs (e.g. `openssl rand -hex 32`
          // command text itself) are instructions, not secrets.
          if (/openssl rand/.test(content.slice(Math.max(0, match.index - 60), match.index))) {
            continue;
          }
          hits.push(`${file.replace(rootDir, '.')}:${name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('real .env files exist locally but stay git-ignored', () => {
    let tracked = '';
    try {
      tracked = execSync('git ls-files', {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // Not a git checkout (e.g. exported archive): fall back to .gitignore rules.
      const gitignore = read('.gitignore');
      expect(gitignore).toMatch(/^\.env$/m);
      return;
    }
    const envFiles = tracked
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) => /(^|\/)\.env(\.|$)/.test(l) && !l.endsWith('.example'),
      );
    expect(envFiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Frontend production wiring
// ---------------------------------------------------------------------------

describe('deployment: frontend production wiring', () => {
  it('uses standalone output and no hardcoded backend host in code', () => {
    const config = read('frontend/next.config.ts');
    expect(config).toMatch(/output:\s*['"]standalone['"]/);
    const dashboard = read('frontend/src/app/dashboard/page.tsx');
    expect(dashboard).not.toMatch(/http:\/\/localhost:3001/);
    const api = read('frontend/src/lib/api.ts');
    expect(api).toMatch(/NEXT_PUBLIC_API_URL/);
    expect(api).toMatch(/downloadFile/);
  });
});
