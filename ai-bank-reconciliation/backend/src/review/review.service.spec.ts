import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompanyRole,
  ReviewActionType,
  ReviewStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { availableActions, transitionFor } from './review-state-machine.js';
import { ReviewService } from './review.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OUTSIDER_ID = '33333333-3333-4333-8333-333333333333';
const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESULT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ALIAS_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const baseResult = {
  id: RESULT_ID,
  matchStatus: 'REVIEW_REQUIRED',
  reviewStatus: ReviewStatus.PENDING_REVIEW,
  reviewVersion: 0,
  lastReviewedBy: null,
  lastReviewedAt: null,
  run: { id: RUN_ID, companyId: COMPANY_ID },
};

function makePrismaMock() {
  return {
    companyUser: { findUnique: vi.fn() },
    reconciliationResult: { findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    reviewAction: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    partyAlias: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    aIAnalysis: { findFirst: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) =>
      (ops as unknown[]).map((op, i) => ({ op: i })),
    ),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function membership(role: CompanyRole) {
  return { id: 'm-1', userId: USER_ID, companyId: COMPANY_ID, role };
}

function service(prisma: PrismaMock): ReviewService {
  return new ReviewService(prisma as unknown as PrismaService);
}

describe('review state machine', () => {
  it('valid transitions map to the correct statuses', () => {
    expect(transitionFor('START_REVIEW', 'PENDING_REVIEW')).toBe('IN_REVIEW');
    expect(transitionFor('CONFIRM_MATCH', 'IN_REVIEW')).toBe('CONFIRMED_MATCH');
    expect(transitionFor('CONFIRM_WRONG_PARTY', 'IN_REVIEW')).toBe('WRONG_PARTY');
    expect(transitionFor('CONFIRM_DUPLICATE', 'IN_REVIEW')).toBe('DUPLICATE_CONFIRMED');
    expect(transitionFor('IGNORE', 'PENDING_REVIEW')).toBe('IGNORED');
    expect(transitionFor('REOPEN', 'CONFIRMED_MATCH')).toBe('IN_REVIEW');
    expect(transitionFor('CONFIRM_MATCH', 'PENDING_REVIEW')).toBeUndefined();
    expect(transitionFor('REJECT', 'REJECTED')).toBeUndefined();
    expect(transitionFor('REOPEN', 'IN_REVIEW')).toBeUndefined();
  });

  it('available actions respect the status', () => {
    expect(availableActions('PENDING_REVIEW')).toContain('START_REVIEW');
    expect(availableActions('PENDING_REVIEW')).not.toContain('CONFIRM_MATCH');
    expect(availableActions('IN_REVIEW')).toContain('CONFIRM_MATCH');
    expect(availableActions('CONFIRMED_MATCH')).toContain('REOPEN');
    expect(availableActions('IGNORED')).toContain('REOPEN');
  });
});

describe('ReviewService', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.clearAllMocks();
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...baseResult,
    });
    prisma.companyUser.findUnique.mockResolvedValue(membership('ACCOUNTANT'));
    prisma.reviewAction.findMany.mockResolvedValue([]);
    prisma.aIAnalysis.findFirst.mockResolvedValue(null);
    prisma.reconciliationResult.update.mockResolvedValue({
      ...baseResult,
      reviewVersion: 1,
    });
    prisma.reviewAction.create.mockResolvedValue({ id: 'ra-1' });
    prisma.auditLog.create.mockResolvedValue({ id: 'al-1' });
  });

  const startThen = async (
    prismaMock: PrismaMock,
    action: ReviewActionType,
    comment?: string,
  ) => {
    // START_REVIEW first (PENDING → IN_REVIEW), then the target action.
    prismaMock.reconciliationResult.findUnique
      .mockResolvedValueOnce({ ...baseResult })
      .mockResolvedValueOnce({
        ...baseResult,
        reviewStatus: ReviewStatus.IN_REVIEW,
        reviewVersion: 1,
      });
    const svc = service(prismaMock);
    await svc.reviewAction(USER_ID, RESULT_ID, { action: 'START_REVIEW' });
    return svc.reviewAction(USER_ID, RESULT_ID, { action, comment });
  };

  it('1. confirm match works (optional comment)', async () => {
    const result = await startThen(prisma, 'CONFIRM_MATCH');
    expect(result.reviewStatus).toBe('CONFIRMED_MATCH');
    expect(prisma.reviewAction.create).toHaveBeenCalledTimes(2);
  });

  it('2. confirm wrong party requires and stores a comment', async () => {
    await expect(
      startThen(prisma, 'CONFIRM_WRONG_PARTY'),
    ).rejects.toThrow('comment is required');

    const result = await startThen(
      prisma,
      'CONFIRM_WRONG_PARTY',
      'Bank narration clearly indicates ABC Traders.',
    );
    expect(result.reviewStatus).toBe('WRONG_PARTY');
  });

  it('3/4/5. confirm duplicate, amount mismatch, date mismatch', async () => {
    expect(
      (await startThen(prisma, 'CONFIRM_DUPLICATE', 'Same UTR twice')).reviewStatus,
    ).toBe('DUPLICATE_CONFIRMED');

    prisma.reconciliationResult.findUnique
      .mockResolvedValueOnce({ ...baseResult })
      .mockResolvedValueOnce({ ...baseResult, reviewStatus: ReviewStatus.IN_REVIEW, reviewVersion: 1 });
    await service(prisma).reviewAction(USER_ID, RESULT_ID, { action: 'START_REVIEW' });
    expect(
      (await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'CONFIRM_AMOUNT_MISMATCH',
        comment: 'Ledger says 74500',
      })).reviewStatus,
    ).toBe('AMOUNT_MISMATCH_CONFIRMED');

    prisma.reconciliationResult.findUnique
      .mockResolvedValueOnce({ ...baseResult })
      .mockResolvedValueOnce({ ...baseResult, reviewStatus: ReviewStatus.IN_REVIEW, reviewVersion: 1 });
    await service(prisma).reviewAction(USER_ID, RESULT_ID, { action: 'START_REVIEW' });
    expect(
      (await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'CONFIRM_DATE_MISMATCH',
        comment: 'Cheque cleared later',
      })).reviewStatus,
    ).toBe('DATE_MISMATCH_CONFIRMED');
  });

  it('6/7. confirm missing in tally / bank', async () => {
    prisma.reconciliationResult.findUnique
      .mockResolvedValueOnce({ ...baseResult })
      .mockResolvedValueOnce({ ...baseResult, reviewStatus: ReviewStatus.IN_REVIEW, reviewVersion: 1 });
    await service(prisma).reviewAction(USER_ID, RESULT_ID, { action: 'START_REVIEW' });
    expect(
      (await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'CONFIRM_MISSING_IN_TALLY',
        comment: 'No Tally entry in period',
      })).reviewStatus,
    ).toBe('MISSING_IN_TALLY_CONFIRMED');

    prisma.reconciliationResult.findUnique
      .mockResolvedValueOnce({ ...baseResult })
      .mockResolvedValueOnce({ ...baseResult, reviewStatus: ReviewStatus.IN_REVIEW, reviewVersion: 1 });
    await service(prisma).reviewAction(USER_ID, RESULT_ID, { action: 'START_REVIEW' });
    expect(
      (await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'CONFIRM_MISSING_IN_BANK',
        comment: 'No bank entry in period',
      })).reviewStatus,
    ).toBe('MISSING_IN_BANK_CONFIRMED');
  });

  it('8/9. reject and ignore', async () => {
    prisma.reconciliationResult.findUnique
      .mockResolvedValueOnce({ ...baseResult })
      .mockResolvedValueOnce({ ...baseResult, reviewStatus: ReviewStatus.IN_REVIEW, reviewVersion: 1 });
    await service(prisma).reviewAction(USER_ID, RESULT_ID, { action: 'START_REVIEW' });
    expect(
      (await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'REJECT',
        comment: 'Not an exception',
      })).reviewStatus,
    ).toBe('REJECTED');

    prisma.reconciliationResult.findUnique.mockResolvedValue({ ...baseResult });
    expect(
      (await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'IGNORE',
        comment: 'Immaterial',
      })).reviewStatus,
    ).toBe('IGNORED');
  });

  it('10. reopen works from terminal states', async () => {
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...baseResult,
      reviewStatus: ReviewStatus.CONFIRMED_MATCH,
      reviewVersion: 2,
    });
    const result = await service(prisma).reviewAction(USER_ID, RESULT_ID, {
      action: 'REOPEN',
    });
    expect(result.reviewStatus).toBe('IN_REVIEW');
  });

  it('11. invalid transitions yield 409', async () => {
    // CONFIRM_MATCH straight from PENDING_REVIEW.
    await expect(
      service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'CONFIRM_MATCH',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // START_REVIEW from IN_REVIEW.
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...baseResult,
      reviewStatus: ReviewStatus.IN_REVIEW,
    });
    await expect(
      service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'START_REVIEW',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('12. missing required comment yields 409', async () => {
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...baseResult,
      reviewStatus: ReviewStatus.IN_REVIEW,
    });
    await expect(
      service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'REJECT',
        comment: '   ',
      }),
    ).rejects.toThrow('comment is required');
  });

  it('13. viewer cannot review', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('VIEWER'));
    await expect(
      service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'START_REVIEW',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('14/15/16. accountant, reviewer, owner can review', async () => {
    for (const role of [
      CompanyRole.ACCOUNTANT,
      CompanyRole.REVIEWER,
      CompanyRole.OWNER,
    ]) {
      prisma.companyUser.findUnique.mockResolvedValue(membership(role));
      prisma.reconciliationResult.findUnique.mockResolvedValue({ ...baseResult });
      const result = await service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'START_REVIEW',
      });
      expect(result.reviewStatus).toBe('IN_REVIEW');
    }
  });

  it('17. cross-company review rejected', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(null);
    await expect(
      service(prisma).reviewAction(OUTSIDER_ID, RESULT_ID, {
        action: 'START_REVIEW',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('18/19. history + audit log created in one transaction', async () => {
    prisma.reconciliationResult.findUnique.mockResolvedValue({ ...baseResult });
    await service(prisma).reviewAction(USER_ID, RESULT_ID, {
      action: 'START_REVIEW',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0][0] as { op?: number }[];
    expect(ops).toHaveLength(3); // result update + history + audit
    expect(prisma.reviewAction.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('20. stale review version yields 409 (no silent overwrite)', async () => {
    prisma.reconciliationResult.findUnique.mockResolvedValue({
      ...baseResult,
      reviewVersion: 3,
    });
    await expect(
      service(prisma).reviewAction(USER_ID, RESULT_ID, {
        action: 'START_REVIEW',
        reviewVersion: 2,
      }),
    ).rejects.toThrow('Review status changed');
    expect(prisma.reconciliationResult.update).not.toHaveBeenCalled();
  });

  it('21. party alias creation (owner)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.partyAlias.create.mockResolvedValue({
      id: ALIAS_ID,
      companyId: COMPANY_ID,
      canonicalParty: 'ABC Traders',
      alias: 'ABC Traders Pvt Ltd',
      isApproved: false,
    });
    const alias = await service(prisma).createAlias(USER_ID, COMPANY_ID, {
      canonicalParty: 'ABC Traders',
      alias: 'ABC Traders Pvt Ltd',
    });
    expect(alias.isApproved).toBe(false);
    expect(prisma.partyAlias.create).toHaveBeenCalled();
  });

  it('22. party alias approval (owner)', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('OWNER'));
    prisma.partyAlias.findUnique.mockResolvedValue({
      id: ALIAS_ID,
      companyId: COMPANY_ID,
      isApproved: false,
    });
    prisma.partyAlias.update.mockResolvedValue({
      id: ALIAS_ID,
      isApproved: true,
    });
    const alias = await service(prisma).approveAlias(USER_ID, ALIAS_ID);
    expect(alias.isApproved).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('23. reviewer cannot create or approve aliases', async () => {
    prisma.companyUser.findUnique.mockResolvedValue(membership('REVIEWER'));
    await expect(
      service(prisma).createAlias(USER_ID, COMPANY_ID, {
        canonicalParty: 'A',
        alias: 'B',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    prisma.partyAlias.findUnique.mockResolvedValue({
      id: ALIAS_ID,
      companyId: COMPANY_ID,
      isApproved: false,
    });
    await expect(
      service(prisma).approveAlias(USER_ID, ALIAS_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('24. AI analysis row present does not change review status', async () => {
    prisma.aIAnalysis.findFirst.mockResolvedValue({
      classification: 'WRONG_PARTY_CANDIDATE',
      aiConfidence: 0.91,
      riskLevel: 'HIGH',
      recommendedAction: 'Review Tally party allocation',
    });
    const review = await service(prisma).getReview(USER_ID, RESULT_ID);
    expect(review.reviewStatus).toBe(ReviewStatus.PENDING_REVIEW);
    expect(review.aiAnalysis?.classification).toBe('WRONG_PARTY_CANDIDATE');
    expect(prisma.reconciliationResult.update).not.toHaveBeenCalled();
  });

  it('25/26. split and duplicate results are reviewable via the same flow', async () => {
    for (const matchStatus of ['POSSIBLE_MATCH', 'DUPLICATE_CANDIDATE']) {
      prisma.reconciliationResult.findUnique.mockResolvedValue({
        ...baseResult,
        matchStatus,
      });
      const review = await service(prisma).getReview(USER_ID, RESULT_ID);
      expect(review.matchStatus).toBe(matchStatus);
      expect(review.availableActions).toContain('START_REVIEW');
    }
  });
});
