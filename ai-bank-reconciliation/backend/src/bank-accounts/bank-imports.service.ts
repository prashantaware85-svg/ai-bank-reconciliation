import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CompanyRole, ImportStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ConfirmImportDto } from './dto/confirm-import.dto.js';
import type { PreviewResult } from './statement/statement-parser.js';
import {
  MAX_FILE_BYTES,
  applyMapping,
  buildPreview,
  extensionOf,
  fileTypeOf,
  parseWorkbook,
  validateMapping,
} from './statement/statement-parser.js';
import {
  detectMapping,
  mappingGaps,
  type ColumnMapping,
} from './statement/column-map.js';

const EDITOR_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];
const INSERT_BATCH = 500;

interface AccountRef {
  id: string;
  companyId: string;
  bankName: string;
  accountName: string;
}

function badFile(message: string): BadRequestException {
  return new BadRequestException(message);
}

/**
 * Statement import orchestration. Files are parsed in memory and never
 * executed; only parsed row data reaches the database (with `originalRow`
 * preserved verbatim as JSONB).
 */
@Injectable()
export class BankImportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Bank account not found');
    }
    return membership;
  }

  private async requireEditor(userId: string, companyId: string) {
    const membership = await this.requireMembership(userId, companyId);
    if (!EDITOR_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can import statements',
      );
    }
    return membership;
  }

  private async requireAccount(
    userId: string,
    bankAccountId: string,
  ): Promise<AccountRef> {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }
    await this.requireMembership(userId, account.companyId);
    return account;
  }

  private checkFile(file: Express.Multer.File | undefined): {
    buffer: Buffer;
    fileName: string;
  } {
    if (!file || file.size === 0 || !file.originalname) {
      throw badFile('No file uploaded or file is empty');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw badFile('File exceeds the 10 MB size limit');
    }
    if (!fileTypeOf(file.originalname)) {
      throw badFile(
        `Unsupported file type "${extensionOf(file.originalname) || '(none)'}". Allowed: .xlsx, .xls, .csv`,
      );
    }
    return { buffer: file.buffer, fileName: file.originalname };
  }

  /** Preview: parse + detect mapping. Writes nothing to the database. */
  async preview(
    userId: string,
    bankAccountId: string,
    file: Express.Multer.File | undefined,
  ): Promise<PreviewResult> {
    const account = await this.requireAccount(userId, bankAccountId);
    await this.requireEditor(userId, account.companyId);
    const { buffer, fileName } = this.checkFile(file);
    try {
      return buildPreview(buffer, fileName);
    } catch (error) {
      throw badFile(
        error instanceof Error ? error.message : 'Unreadable file',
      );
    }
  }

  /** Confirm: re-parse with the (possibly corrected) mapping and store rows. */
  async confirm(
    userId: string,
    bankAccountId: string,
    file: Express.Multer.File | undefined,
    dto: ConfirmImportDto,
  ) {
    const account = await this.requireAccount(userId, bankAccountId);
    await this.requireEditor(userId, account.companyId);
    const { buffer, fileName } = this.checkFile(file);

    let rows: Record<string, unknown>[];
    let detectedColumns: string[];
    try {
      const parsed = parseWorkbook(buffer, fileName);
      rows = parsed.rows;
      detectedColumns = parsed.headers;
    } catch (error) {
      throw badFile(
        error instanceof Error ? error.message : 'Unreadable file',
      );
    }

    let mapping: ColumnMapping;
    if (dto.mapping !== undefined) {
      const checked = validateMapping(dto.mapping, detectedColumns);
      if (checked.errors.length > 0) {
        throw new UnprocessableEntityException(checked.errors.join('; '));
      }
      mapping = checked.mapping;
    } else {
      const detected = detectMapping(detectedColumns);
      const gaps = mappingGaps(detected.mapping);
      if (gaps.length > 0) {
        throw new UnprocessableEntityException(
          `Missing required mapping: ${gaps.join('; ')}`,
        );
      }
      mapping = detected.mapping;
    }

    const duplicate = await this.prisma.bankImport.findFirst({
      where: {
        companyId: account.companyId,
        bankAccountId: account.id,
        fileName,
        status: ImportStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate && dto.allowDuplicate !== true) {
      throw new ConflictException(
        `Possible duplicate import of "${fileName}" (previously imported ${duplicate.totalRows} rows on ${duplicate.createdAt.toISOString()}). Confirm with allowDuplicate to proceed.`,
      );
    }

    const bankImport = await this.prisma.bankImport.create({
      data: {
        companyId: account.companyId,
        bankAccountId: account.id,
        fileName,
        fileType: fileTypeOf(fileName) as string,
        totalRows: rows.length,
        status: ImportStatus.PENDING,
      },
    });
    await this.prisma.bankImport.update({
      where: { id: bankImport.id },
      data: { status: ImportStatus.PROCESSING },
    });

    const outcome = applyMapping(rows, mapping);
    const okRows = outcome.rows.filter((r) => r.status === 'ok');

    for (let i = 0; i < okRows.length; i += INSERT_BATCH) {
      const batch = okRows.slice(i, i + INSERT_BATCH);
      await this.prisma.bankTransaction.createMany({
        data: batch.map((r) => ({
          companyId: account.companyId,
          bankAccountId: account.id,
          importId: bankImport.id,
          transactionDate: r.transactionDate as Date,
          valueDate: r.valueDate ?? undefined,
          description: r.description,
          narration: r.narration,
          chequeNumber: r.chequeNumber,
          reference: r.reference,
          debit: r.debit ?? undefined,
          credit: r.credit ?? undefined,
          amount: r.amount as string,
          direction: r.direction as 'DEBIT' | 'CREDIT',
          balance: r.balance ?? undefined,
          originalRow: r.originalRow,
          normalizedNarration: r.normalizedNarration,
          normalizedReference: r.normalizedReference,
        })),
      });
    }

    const status =
      outcome.imported > 0 ? ImportStatus.COMPLETED : ImportStatus.FAILED;
    const summary = {
      mapping,
      warnings: outcome.warnings,
      rowErrors: outcome.rowErrors,
      dateRange: outcome.dateRange,
      totalDebit: outcome.totalDebit,
      totalCredit: outcome.totalCredit,
      duplicateWarning: duplicate
        ? `Re-import of "${fileName}" confirmed by user`
        : undefined,
    };
    await this.prisma.bankImport.update({
      where: { id: bankImport.id },
      data: {
        status,
        importedRows: outcome.imported,
        skippedRows: outcome.skipped,
        failedRows: outcome.failed,
        summary,
      },
    });

    return {
      importId: bankImport.id,
      status,
      summary: {
        file: fileName,
        bankAccount: {
          id: account.id,
          bankName: account.bankName,
          accountName: account.accountName,
        },
        totalRows: rows.length,
        imported: outcome.imported,
        skipped: outcome.skipped,
        failed: outcome.failed,
        warnings: outcome.warnings,
        rowErrors: outcome.rowErrors,
        dateRange: outcome.dateRange,
        totalDebit: outcome.totalDebit,
        totalCredit: outcome.totalCredit,
      },
    };
  }

  async listImports(
    userId: string,
    companyId: string,
    bankAccountId?: string,
  ) {
    await this.requireMembership(userId, companyId);
    if (bankAccountId) {
      const account = await this.prisma.bankAccount.findUnique({
        where: { id: bankAccountId },
      });
      if (!account || account.companyId !== companyId) {
        throw new NotFoundException('Bank account not found');
      }
    }
    return this.prisma.bankImport.findMany({
      where: {
        companyId,
        ...(bankAccountId ? { bankAccountId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getImport(userId: string, importId: string) {
    const bankImport = await this.prisma.bankImport.findUnique({
      where: { id: importId },
      include: { bankAccount: true },
    });
    if (!bankImport) {
      throw new NotFoundException('Import not found');
    }
    await this.requireMembership(userId, bankImport.companyId);
    return bankImport;
  }

  async listTransactions(
    userId: string,
    importId: string,
    limit: number,
    offset: number,
  ) {
    const bankImport = await this.prisma.bankImport.findUnique({
      where: { id: importId },
    });
    if (!bankImport) {
      throw new NotFoundException('Import not found');
    }
    await this.requireMembership(userId, bankImport.companyId);
    const take = Math.min(Math.max(limit, 1), 500);
    const skip = Math.max(offset, 0);
    const [total, rows] = await Promise.all([
      this.prisma.bankTransaction.count({ where: { importId } }),
      this.prisma.bankTransaction.findMany({
        where: { importId },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        take,
        skip,
      }),
    ]);
    return { total, rows };
  }
}
