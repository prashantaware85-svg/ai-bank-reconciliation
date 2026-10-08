import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const TEST_SECRETS = {
  JWT_SECRET: 'test-access-secret-please-change',
  JWT_REFRESH_SECRET: 'test-refresh-secret-please-change',
};

function makeConfigService() {
  return {
    getOrThrow: (key: string) => {
      const value = (TEST_SECRETS as Record<string, string>)[key];
      if (!value) throw new Error(`Missing config: ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

function makePrismaMock() {
  return {
    user: { findUnique: vi.fn(), create: vi.fn() },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prismaMock: PrismaMock): AuthService {
  return new AuthService(
    prismaMock as unknown as PrismaService,
    new JwtService({}),
    makeConfigService(),
  );
}

function makeGuard(prismaMock: PrismaMock): {
  guard: JwtAuthGuard;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request: {
    headers: Record<string, string | undefined>;
    user?: unknown;
  } = { headers: {} };
  const guard = new JwtAuthGuard(
    new JwtService({}),
    makeConfigService(),
    prismaMock as unknown as PrismaService,
  );
  return { guard, request };
}

function httpContext(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

const baseUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  passwordHash: '',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AuthService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
  });

  it('registers a user successfully without exposing passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        ...baseUser,
        name: args.data['name'],
        email: args.data['email'],
        passwordHash: args.data['passwordHash'],
      }),
    );
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

    const service = makeService(prisma);
    const result = await service.register(
      Object.assign(new RegisterDto(), {
        name: 'Test User',
        email: 'TEST@Example.com',
        password: 'StrongPass123',
      }),
    );

    expect(result.user.email).toBe('test@example.com');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    const storedHash = prisma.user.create.mock.calls[0][0].data
      .passwordHash as string;
    expect(storedHash).not.toContain('StrongPass123');
  });

  it('rejects duplicate email registration', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser);
    const service = makeService(prisma);

    await expect(
      service.register(
        Object.assign(new RegisterDto(), {
          name: 'Other',
          email: 'test@example.com',
          password: 'StrongPass123',
        }),
      ),
    ).rejects.toThrow('Email already registered');
  });

  it('rejects an invalid email via DTO validation', async () => {
    const dto = Object.assign(new RegisterDto(), {
      name: 'Test',
      email: 'not-an-email',
      password: 'StrongPass123',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a weak password via DTO validation', async () => {
    const dto = Object.assign(new RegisterDto(), {
      name: 'Test',
      email: 'test@example.com',
      password: 'short',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('logs in successfully with correct credentials', async () => {
    const service = makeService(prisma);
    const passwordHash = (await import('argon2')).default
      ? await (await import('argon2')).hash('CorrectPass123')
      : '';
    prisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      passwordHash,
    });
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

    const result = await service.login(
      Object.assign(new LoginDto(), {
        email: 'test@example.com',
        password: 'CorrectPass123',
      }),
    );
    expect(result.user.email).toBe('test@example.com');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.accessToken).toBeTruthy();
  });

  it('rejects login with a wrong password using a safe message', async () => {
    const service = makeService(prisma);
    const argon2 = await import('argon2');
    prisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      passwordHash: await argon2.hash('CorrectPass123'),
    });

    await expect(
      service.login(
        Object.assign(new LoginDto(), {
          email: 'test@example.com',
          password: 'WrongPass999',
        }),
      ),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects protected access without a token', async () => {
    const { guard, request } = makeGuard(prisma);
    await expect(
      guard.canActivate(httpContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows protected access with a valid token', async () => {
    const service = makeService(prisma);
    const argon2 = await import('argon2');
    const user = {
      ...baseUser,
      passwordHash: await argon2.hash('CorrectPass123'),
    };
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

    const { accessToken } = await service.login(
      Object.assign(new LoginDto(), {
        email: 'test@example.com',
        password: 'CorrectPass123',
      }),
    );

    const { guard, request } = makeGuard(prisma);
    request.headers['authorization'] = `Bearer ${accessToken}`;
    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'user-1' });
    expect(request.user).not.toHaveProperty('passwordHash');
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const service = makeService(prisma);
    const argon2 = await import('argon2');
    const user = {
      ...baseUser,
      passwordHash: await argon2.hash('CorrectPass123'),
    };
    prisma.user.findUnique.mockResolvedValue(user);

    interface StoredRecord {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    }
    const records = new Map<string, StoredRecord>();
    let seq = 0;
    prisma.refreshToken.create.mockImplementation(
      async (args: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }) => {
        seq += 1;
        const record: StoredRecord = {
          id: `rt-${seq}`,
          ...args.data,
          revokedAt: null,
        };
        records.set(record.tokenHash, record);
        return record;
      },
    );
    prisma.refreshToken.findUnique.mockImplementation(
      async (args: { where: { tokenHash: string } }) =>
        records.get(args.where.tokenHash) ?? null,
    );
    prisma.refreshToken.update.mockImplementation(
      async (args: { where: { id: string }; data: { revokedAt: Date } }) => {
        const record = [...records.values()].find((r) => r.id === args.where.id);
        if (record) record.revokedAt = args.data.revokedAt;
        return record;
      },
    );

    const first = await service.login(
      Object.assign(new LoginDto(), {
        email: 'test@example.com',
        password: 'CorrectPass123',
      }),
    );

    const rotated = await service.refresh(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('revokes the refresh token on logout', async () => {
    const service = makeService(prisma);
    const argon2 = await import('argon2');
    const user = {
      ...baseUser,
      passwordHash: await argon2.hash('CorrectPass123'),
    };
    prisma.user.findUnique.mockResolvedValue(user);

    let storedRecord: {
      id: string;
      tokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    } | null = null;
    prisma.refreshToken.create.mockImplementation(
      async (args: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }) => {
        storedRecord = { id: 'rt-1', ...args.data, revokedAt: null };
        return storedRecord;
      },
    );
    prisma.refreshToken.findUnique.mockImplementation(async () => storedRecord);
    prisma.refreshToken.updateMany.mockImplementation(async () => {
      if (storedRecord) storedRecord.revokedAt = new Date();
      return { count: 1 };
    });
    prisma.refreshToken.update.mockImplementation(async () => storedRecord);

    const { refreshToken } = await service.login(
      Object.assign(new LoginDto(), {
        email: 'test@example.com',
        password: 'CorrectPass123',
      }),
    );

    await expect(service.logout(refreshToken)).resolves.toEqual({
      success: true,
    });
    await expect(service.refresh(refreshToken)).rejects.toThrow(
      'Invalid refresh token',
    );
  });
});
