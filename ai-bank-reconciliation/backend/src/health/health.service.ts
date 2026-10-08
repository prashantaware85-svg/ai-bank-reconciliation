import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'node:net';
import { PrismaService } from '../prisma/prisma.service.js';

export type DependencyState = 'up' | 'down';

export interface Readiness {
  status: 'ok' | 'degraded';
  database: DependencyState;
  redis: DependencyState;
}

/**
 * Health checks (Step 12). Liveness is trivially "ok" when the process
 * answers. Readiness probes PostgreSQL (SELECT 1) and Redis (TCP connect
 * to REDIS_URL host/port, no AUTH sent, no data read). No secrets logged.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  liveness(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async readiness(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);
    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
      database,
      redis,
    };
  }

  private async checkPostgres(): Promise<DependencyState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  checkRedisUrl(raw: string | undefined): { host: string; port: number } {
    const fallback = { host: '127.0.0.1', port: 6379 };
    if (!raw) return fallback;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'redis:') return fallback;
      return {
        host: url.hostname || fallback.host,
        port: url.port ? Number(url.port) : fallback.port,
      };
    } catch {
      return fallback;
    }
  }

  checkRedis(timeoutMs = 2000): Promise<DependencyState> {
    const { host, port } = this.checkRedisUrl(
      this.config.get<string>('REDIS_URL'),
    );
    return new Promise((resolve) => {
      const socket = new Socket();
      const done = (state: DependencyState) => {
        socket.destroy();
        resolve(state);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done('up'));
      socket.once('timeout', () => done('down'));
      socket.once('error', () => done('down'));
      socket.connect(port, host);
    });
  }
}
