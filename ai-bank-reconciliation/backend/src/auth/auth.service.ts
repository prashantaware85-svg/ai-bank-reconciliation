import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: SafeUser;
}

interface RefreshPayload {
  sub: string;
  type: string;
}

/**
 * Authentication service.
 *
 * Security notes:
 * - Passwords are hashed with Argon2id; plain passwords are never stored.
 * - `passwordHash` is never included in API responses (see toSafeUser).
 * - Refresh JWTs are stored only as one-way SHA-256 digests; rotation
 *   revokes the presenting token and issues a fresh pair.
 * - Error messages are generic to avoid user enumeration.
 */
@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
    this.jwtRefreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  toSafeUser(user: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SafeUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /** One-way digest used for refresh-token lookup. Never stores the token. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { name: dto.name.trim(), email, passwordHash },
    });

    const tokens = await this.issueTokenPair(user.id, user.email);
    return { user: this.toSafeUser(user), ...tokens };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let valid = false;
    try {
      valid = await argon2.verify(user.passwordHash, dto.password);
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokenPair(user.id, user.email);
    return { user: this.toSafeUser(user), ...tokens };
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(
        refreshToken,
        { secret: this.jwtRefreshSecret },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!payload?.sub || payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotation: revoke the presenting token before issuing a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokenPair(user.id, user.email);
    return { user: this.toSafeUser(user), ...tokens };
  }

  /** Idempotent — always succeeds so callers can't probe token validity. */
  async logout(refreshToken: string): Promise<{ success: true }> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async me(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.toSafeUser(user);
  }

  private async issueTokenPair(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email },
      { secret: this.jwtSecret, expiresIn: ACCESS_TOKEN_TTL },
    );
    const refreshToken = await this.jwtService.signAsync(
      // jti guarantees every refresh token is unique, even within one second.
      { sub: userId, type: 'refresh', jti: randomUUID() },
      { secret: this.jwtRefreshSecret, expiresIn: REFRESH_TOKEN_TTL },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }
}
