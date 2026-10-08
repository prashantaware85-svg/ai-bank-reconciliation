import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

function service(
  overrides: {
    queryRaw?: () => Promise<unknown>;
    redisUrl?: string;
  } = {},
): HealthService {
  const prisma = {
    $queryRaw: overrides.queryRaw ?? (async () => [{ '?column?': 1 }]),
  } as unknown as PrismaService;
  const config = {
    get: (key: string) =>
      key === 'REDIS_URL' ? (overrides.redisUrl ?? 'redis://127.0.0.1:6379') : undefined,
  } as unknown as ConfigService;
  return new HealthService(prisma, config);
}

describe('HealthService', () => {
  it('liveness is always ok', () => {
    const result = service().liveness();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });

  it('ready is ok when postgres and redis are up', async () => {
    // Redis on a port that refuses fast would be flaky; point at a
    // blackhole is slow — instead override checkRedis via subclass.
    class UpHealth extends HealthService {
      override checkRedis(): Promise<'up' | 'down'> {
        void this;
        return Promise.resolve('up');
      }
    }
    const prisma = {
      $queryRaw: async () => [{ '?column?': 1 }],
    } as unknown as PrismaService;
    const config = { get: () => undefined } as unknown as ConfigService;
    const svc = new UpHealth(prisma, config);
    const result = await svc.readiness();
    expect(result).toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });

  it('ready is degraded when postgres is down', async () => {
    const svc = service({
      queryRaw: async () => {
        throw new Error('connection refused');
      },
      redisUrl: 'redis://127.0.0.1:1',
    });
    const result = await svc.readiness();
    expect(result.database).toBe('down');
    expect(result.redis).toBe('down');
    expect(result.status).toBe('degraded');
  });

  it('redis check fails closed on unreachable host', async () => {
    const svc = service({ redisUrl: 'redis://127.0.0.1:1' });
    await expect(svc.checkRedis(500)).resolves.toBe('down');
  }, 10000);

  it('parses REDIS_URL safely with fallbacks', () => {
    const svc = service();
    expect(svc.checkRedisUrl(undefined)).toEqual({
      host: '127.0.0.1',
      port: 6379,
    });
    expect(svc.checkRedisUrl('redis://cache:6380')).toEqual({
      host: 'cache',
      port: 6380,
    });
    expect(svc.checkRedisUrl('not a url')).toEqual({
      host: '127.0.0.1',
      port: 6379,
    });
    expect(svc.checkRedisUrl('http://evil:1234')).toEqual({
      host: '127.0.0.1',
      port: 6379,
    });
  });

  it('never exposes secrets in health output', async () => {
    const svc = service({
      queryRaw: async () => {
        throw new Error('password authentication failed for user "x"');
      },
    });
    const result = await svc.readiness();
    expect(JSON.stringify(result)).not.toMatch(/password|secret|token|key/i);
  });
});
