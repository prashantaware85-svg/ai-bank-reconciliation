import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyRole,
  ReviewActionType,
  type ReviewStatus,
} from '../generated/prisma/client.js';
import { normalizeText } from '../common/text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateAliasDto } from './dto/review-filter.dto.js';
import type { ReviewActionDto } from './dto/review-action.dto.js';
import {
  COMMENT_REQUIRED,
  availableActions,
  transitionFor,
  type ReviewStatusValue,
} from './review-state-machine.js';

const REVIEW_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
  CompanyRole.REVIEWER,
];
const ALIAS_MANAGE_ROLES: CompanyRole[] = [
  CompanyRole.OWNER,
  CompanyRole.ACCOUNTANT,
];

/**
 * Human review workflow (Step 10). The accountant/reviewer is the final
 * decision maker; AI is advisory only and can never trigger or change a
 * review action. Immutable history + AuditLog in the same transaction;
 * optimistic concurrency via reviewVersion.
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireResult(userId: string, resultId: string) {
    const result = await this.prisma.reconciliationResult.findUnique({
      where: { id: resultId },
      include: { run: true },
    });
    if (!result) {
      throw new NotFoundException('Reconciliation result not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: result.run.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Reconciliation result not found');
    }
    return { result, membership };
  }

  /** Immutable history + review state read for one result. */
  async getReview(userId: string, resultId: string) {
    const { result } = await this.requireResult(userId, resultId);
    const [history, ai] = await Promise.all([
      this.prisma.reviewAction.findMany({
        where: { reconciliationResultId: resultId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.aIAnalysis.findFirst({
        where: { reconciliationResultId: resultId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      resultId,
      matchStatus: result.matchStatus,
      reviewStatus: result.reviewStatus,
      reviewVersion: result.reviewVersion,
      lastReviewedBy: result.lastReviewedBy,
      lastReviewedAt: result.lastReviewedAt,
      availableActions: availableActions(
        result.reviewStatus as ReviewStatusValue,
      ),
      reviewHistory: history,
      aiAnalysis: ai
        ? {
            classification: ai.classification,
            aiConfidence: ai.aiConfidence,
            riskLevel: ai.riskLevel,
            recommendedAction: ai.recommendedAction,
            provider: ai.provider,
            model: ai.model,
          }
        : null,
    };
  }

  /**
   * Perform a review action. Validates action + transition + comment +
   * role + optimistic version. Never touches Tally/bank/accounting data;
   * records history + AuditLog atomically.
   */
  async reviewAction(userId: string, resultId: string, dto: ReviewActionDto) {
    const { result, membership } = await this.requireResult(
      userId,
      resultId,
    );
    if (!REVIEW_ROLES.includes(membership.role)) {
      throw new ForbiddenException('Viewers cannot change review status');
    }
    if (!Object.values(ReviewActionType).includes(dto.action)) {
      throw new ConflictException('Invalid review action');
    }

    const current = result.reviewStatus as ReviewStatusValue;
    const next = transitionFor(dto.action, current);
    if (!next) {
      throw new ConflictException(
        `Transition ${dto.action} is not allowed from ${current}. Refresh to see the latest status.`,
      );
    }
    const comment = dto.comment?.trim();
    if (COMMENT_REQUIRED.includes(dto.action) && !comment) {
      throw new ConflictException('A comment is required for this action');
    }

    // Optimistic concurrency: stale version → 409 (never overwrite).
    const expectedVersion = dto.reviewVersion ?? result.reviewVersion;
    if (expectedVersion !== result.reviewVersion) {
      throw new ConflictException(
        'Review status changed since you opened it. Refresh and try again.',
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.reconciliationResult.update({
        where: {
          id: resultId,
          reviewVersion: result.reviewVersion,
        },
        data: {
          reviewStatus: next as ReviewStatus,
          reviewVersion: { increment: 1 },
          lastReviewedBy: userId,
          lastReviewedAt: new Date(),
        },
      }),
      this.prisma.reviewAction.create({
        data: {
          companyId: result.run.companyId,
          reconciliationResultId: resultId,
          userId,
          action: dto.action,
          previousStatus: current as ReviewStatus,
          newStatus: next as ReviewStatus,
          comment: comment || null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          companyId: result.run.companyId,
          userId,
          action: dto.action,
          entity: 'ReconciliationResult',
          entityId: resultId,
          oldValue: { reviewStatus: current },
          newValue: { reviewStatus: next },
        },
      }),
    ]);
    void updated;

    return {
      resultId,
      reviewStatus: next,
      reviewVersion: result.reviewVersion + 1,
      lastReviewedBy: userId,
      lastReviewedAt: new Date().toISOString(),
    };
  }
  // ------------------------------------------------------------------
  // Party aliases (human-approved only — never created from AI output)
  // ------------------------------------------------------------------

  private async requireAliasAccess(
    userId: string,
    aliasId: string,
  ): Promise<{ companyId: string; role: CompanyRole }> {
    const alias = await this.prisma.partyAlias.findUnique({
      where: { id: aliasId },
    });
    if (!alias) {
      throw new NotFoundException('Party alias not found');
    }
    const membership = await this.prisma.companyUser.findUnique({
      where: {
        userId_companyId: { userId, companyId: alias.companyId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Party alias not found');
    }
    return { companyId: alias.companyId, role: membership.role };
  }

  async listAliases(userId: string, companyId: string) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Party alias not found');
    }
    return this.prisma.partyAlias.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createAlias(userId: string, companyId: string, dto: CreateAliasDto) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Party alias not found');
    }
    if (!ALIAS_MANAGE_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and accountants can create party aliases',
      );
    }
    const normalizedAlias = normalizeText(dto.alias);
    if (!normalizedAlias) {
      throw new ConflictException('Alias must contain usable text');
    }
    try {
      const alias = await this.prisma.partyAlias.create({
        data: {
          companyId,
          canonicalParty: dto.canonicalParty,
          alias: dto.alias,
          normalizedAlias,
          isApproved: false,
          approvedBy: userId,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CREATE_ALIAS',
          entity: 'PartyAlias',
          entityId: alias.id,
          newValue: { canonicalParty: dto.canonicalParty, alias: dto.alias },
        },
      });
      return alias;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictException('This alias already exists');
      }
      throw error;
    }
  }

  async approveAlias(userId: string, aliasId: string) {
    const { companyId, role } = await this.requireAliasAccess(userId, aliasId);
    if (!ALIAS_MANAGE_ROLES.includes(role)) {
      throw new ForbiddenException(
        'Only owners and accountants can approve party aliases',
      );
    }
    const alias = await this.prisma.partyAlias.update({
      where: { id: aliasId },
      data: { isApproved: true, approvedBy: userId, approvedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'APPROVE_ALIAS',
        entity: 'PartyAlias',
        entityId: aliasId,
        oldValue: { isApproved: false },
        newValue: { isApproved: true },
      },
    });
    return alias;
  }
}
