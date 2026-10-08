import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { createHash } from 'node:crypto';
import {
  CompanyRole,
  ImportStatus,
  TallyConnectionStatus,
} from '../generated/prisma/client.js';
import { normalizeText } from '../common/text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { IngestSyncDto, TallyTxnDto } from './dto/ingest-sync.dto.js';
import type { StartSyncDto } from './dto/start-sync.dto.js';

const MANAGE_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function identityHash(
  companyId: string,
  parts: {
    voucherId?: string;
    voucherNo?: string;
    dateIso: string;
    ledger?: string;
    bankLedger?: string;
    direction: string;
    amount: string;
    reference?: string;
  },
): string {
  return createHash('sha256')
    .update(
      [
        companyId,
        parts.voucherId ?? '',
        parts.voucherNo ?? '',
        parts.dateIso,
        parts.ledger ?? '',
        parts.bankLedger ?? '',
        parts.direction,
        parts.amount,
        parts.reference ?? '',
      ].join('|'),
    )
    .digest('hex');
}

function parseDate(raw: string): Date | undefined {
  if (!DATE_PATTERN.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Sync lifecycle: PENDING (created by UI) → PROCESSING (agent ingesting) →
 * COMPLETED / FAILED. Ingestion is read-only w.r.t. Tally; rows are
 * normalized, deduplicated by identityHash, and never deleted.
 */
@Injectable()
export class TallySyncService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Sync not found');
    }
    return membership;
  }

  private async requireManager(userId: string, companyId: string) {
    const membership = await this.requireMembership(userId, companyId);
    if (!MANAGE_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can run Tally syncs',
      );
    }
    return membership;
  }

  async start(userId: string, connectionId: string, dto: StartSyncDto) {
    const connection = await this.prisma.tallyConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    await this.requireManager(userId, connection.companyId);

    const from = dto.fromDate ? parseDate(dto.fromDate) : undefined;
    const to = dto.toDate ? parseDate(dto.toDate) : undefined;
    if ((dto.fromDate && !from) || (dto.toDate && !to)) {
      throw new BadRequestException('Invalid date range');
    }
    if (from && to && from > to) {
      throw new BadRequestException('fromDate must not be after toDate');
    }

    const sync = await this.prisma.tallySync.create({
      data: {
        companyId: connection.companyId,
        connectionId: connection.id,
        status: ImportStatus.PENDING,
        tallyCompany: dto.tallyCompany.trim(),
        bankLedger: dto.bankLedger.trim(),
        fromDate: from,
        toDate: to,
      },
    });
    return {
      syncId: sync.id,
      status: sync.status,
      tallyCompany: sync.tallyCompany,
      bankLedger: sync.bankLedger,
    };
  }

  async pending(userId: string, companyId: string) {
    await this.requireMembership(userId, companyId);
    return this.prisma.tallySync.findMany({
      where: { companyId, status: ImportStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  }

  async getById(userId: string, syncId: string) {
    const sync = await this.prisma.tallySync.findUnique({
      where: { id: syncId },
      include: { connection: true },
    });
    if (!sync) {
      throw new NotFoundException('Sync not found');
    }
    await this.requireMembership(userId, sync.companyId);
    return sync;
  }

  async fail(userId: string, syncId: string, errorMessage: string) {
    const sync = await this.prisma.tallySync.findUnique({
      where: { id: syncId },
    });
    if (!sync) {
      throw new NotFoundException('Sync not found');
    }
    await this.requireManager(userId, sync.companyId);
    if (
      sync.status !== ImportStatus.PENDING &&
      sync.status !== ImportStatus.PROCESSING
    ) {
      throw new ConflictException(`Sync already ${sync.status}`);
    }
    const updated = await this.prisma.tallySync.update({
      where: { id: syncId },
      data: {
        status: ImportStatus.FAILED,
        errorMessage: errorMessage.slice(0, 2000),
        completedAt: new Date(),
      },
    });
    await this.prisma.tallyConnection.update({
      where: { id: sync.connectionId },
      data: { status: TallyConnectionStatus.ERROR },
    });
    return updated;
  }

  async ingest(userId: string, syncId: string, dto: IngestSyncDto) {
    const sync = await this.prisma.tallySync.findUnique({
      where: { id: syncId },
    });
    if (!sync) {
      throw new NotFoundException('Sync not found');
    }
    await this.requireManager(userId, sync.companyId);
    if (
      sync.status !== ImportStatus.PENDING &&
      sync.status !== ImportStatus.PROCESSING
    ) {
      throw new ConflictException(`Sync already ${sync.status}`);
    }
    if (sync.status === ImportStatus.PENDING) {
      await this.prisma.tallySync.update({
        where: { id: syncId },
        data: { status: ImportStatus.PROCESSING },
      });
    }

    let received = 0;
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const txn of dto.transactions) {
      received += 1;
      const outcome = await this.ingestOne(
        sync.companyId,
        txn,
        sync.bankLedger,
      );
      if (outcome === 'imported') imported += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }

    const done = dto.done !== false;
    const updated = await this.prisma.tallySync.update({
      where: { id: syncId },
      data: {
        recordsReceived: { increment: received },
        recordsImported: { increment: imported },
        recordsSkipped: { increment: skipped },
        recordsFailed: { increment: failed },
        ...(done
          ? { status: ImportStatus.COMPLETED, completedAt: new Date() }
          : { status: ImportStatus.PROCESSING }),
      },
    });
    if (done) {
      await this.prisma.tallyConnection.update({
        where: { id: sync.connectionId },
        data: {
          status: TallyConnectionStatus.CONNECTED,
          lastSyncAt: new Date(),
        },
      });
    }
    return {
      syncId: updated.id,
      status: updated.status,
      recordsReceived: updated.recordsReceived,
      recordsImported: updated.recordsImported,
      recordsSkipped: updated.recordsSkipped,
      recordsFailed: updated.recordsFailed,
    };
  }

  /** Returns 'imported' | 'skipped' | 'failed'. Never throws for row issues. */
  private async ingestOne(
    companyId: string,
    txn: TallyTxnDto,
    defaultBankLedger: string,
  ): Promise<'imported' | 'skipped' | 'failed'> {
    try {
      const date = parseDate(txn.date);
      if (!date) return 'failed';
      if (txn.direction !== 'DEBIT' && txn.direction !== 'CREDIT') {
        return 'failed';
      }
      let amount: Decimal;
      try {
        amount = new Decimal(String(txn.amount).replace(/[,₹$\s]/g, ''));
      } catch {
        return 'failed';
      }
      if (!amount.isFinite()) return 'failed';
      if (amount.isZero()) return 'skipped';
      const magnitude = amount.abs().toString();

      const bankLedger = txn.bankLedger?.trim() || defaultBankLedger;
      const hash = identityHash(companyId, {
        voucherId: txn.voucherId?.trim(),
        voucherNo: txn.voucherNo?.trim(),
        dateIso: date.toISOString(),
        ledger: txn.ledger?.trim(),
        bankLedger,
        direction: txn.direction,
        amount: magnitude,
        reference: txn.reference?.trim(),
      });
      const existing = await this.prisma.tallyTransaction.findUnique({
        where: { companyId_identityHash: { companyId, identityHash: hash } },
      });
      if (existing) return 'skipped';

      await this.prisma.tallyTransaction.create({
        data: {
          companyId,
          voucherId: txn.voucherId?.trim(),
          voucherNo: txn.voucherNo?.trim(),
          date,
          ledger: txn.ledger?.trim(),
          bankLedger,
          voucherType: txn.voucherType?.trim(),
          direction: txn.direction,
          amount: magnitude,
          reference: txn.reference?.trim(),
          narration: txn.narration?.trim(),
          party: txn.party?.trim(),
          normalizedParty: normalizeText(txn.party),
          identityHash: hash,
        },
      });
      return 'imported';
    } catch {
      return 'failed';
    }
  }
}
