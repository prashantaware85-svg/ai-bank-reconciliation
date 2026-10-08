import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CompanyRole,
  TallyConnectionStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateConnectionDto } from './dto/create-connection.dto.js';

const MANAGE_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Tally connection management (read-only mirror metadata — never stores
 * Tally passwords, secrets, or banking credentials).
 */
@Injectable()
export class TallyService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Connection not found');
    }
    return membership;
  }

  private async requireManager(userId: string, companyId: string) {
    const membership = await this.requireMembership(userId, companyId);
    if (!MANAGE_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can manage Tally connections',
      );
    }
    return membership;
  }

  async create(userId: string, companyId: string, dto: CreateConnectionDto) {
    await this.requireManager(userId, companyId);
    try {
      return await this.prisma.tallyConnection.create({
        data: {
          companyId,
          name: dto.name.trim(),
          status: TallyConnectionStatus.DISCONNECTED,
          connectorId: randomUUID().replace(/-/g, ''),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A connection with this name already exists',
        );
      }
      throw error;
    }
  }

  async list(userId: string, companyId: string) {
    await this.requireMembership(userId, companyId);
    return this.prisma.tallyConnection.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getById(userId: string, id: string) {
    const connection = await this.prisma.tallyConnection.findUnique({
      where: { id },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    await this.requireMembership(userId, connection.companyId);
    return connection;
  }

  async remove(userId: string, id: string) {
    const connection = await this.prisma.tallyConnection.findUnique({
      where: { id },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    const membership = await this.requireMembership(
      userId,
      connection.companyId,
    );
    if (membership.role !== CompanyRole.OWNER) {
      throw new ForbiddenException(
        'Only the company owner can delete Tally connections',
      );
    }
    await this.prisma.tallyConnection.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Last-known status from stored sync history. Live reachability can only
   * be determined by the local Tally Agent on the user's PC — never faked.
   */
  async getStatus(userId: string, id: string) {
    const connection = await this.getById(userId, id);
    const lastSync = await this.prisma.tallySync.findFirst({
      where: { connectionId: id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      id: connection.id,
      name: connection.name,
      status: connection.status,
      lastSyncAt: connection.lastSyncAt,
      reachable: null as boolean | null,
      liveCheck:
        'Live reachability requires the local Tally Agent — run `npm run check` in tally-agent/',
      lastSync: lastSync
        ? {
            id: lastSync.id,
            status: lastSync.status,
            completedAt: lastSync.completedAt,
            recordsImported: lastSync.recordsImported,
            recordsFailed: lastSync.recordsFailed,
            errorMessage: lastSync.errorMessage,
          }
        : null,
    };
  }
}
