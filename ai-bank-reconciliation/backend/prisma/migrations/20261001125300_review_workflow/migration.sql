-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_REVIEW', 'IN_REVIEW', 'CONFIRMED_MATCH', 'WRONG_PARTY', 'DUPLICATE_CONFIRMED', 'AMOUNT_MISMATCH_CONFIRMED', 'DATE_MISMATCH_CONFIRMED', 'MISSING_IN_TALLY_CONFIRMED', 'MISSING_IN_BANK_CONFIRMED', 'REJECTED', 'IGNORED', 'CORRECTION_REQUIRED');

-- CreateEnum
CREATE TYPE "ReviewActionType" AS ENUM ('START_REVIEW', 'CONFIRM_MATCH', 'CONFIRM_WRONG_PARTY', 'CONFIRM_DUPLICATE', 'CONFIRM_AMOUNT_MISMATCH', 'CONFIRM_DATE_MISMATCH', 'CONFIRM_MISSING_IN_TALLY', 'CONFIRM_MISSING_IN_BANK', 'REJECT', 'IGNORE', 'REOPEN');

-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('BANK_NARRATION', 'TALLY_PARTY');

-- AlterTable
ALTER TABLE "PartyAlias" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" UUID;

-- AlterTable
ALTER TABLE "ReconciliationResult" ADD COLUMN     "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN     "lastReviewedBy" UUID,
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
ADD COLUMN     "reviewVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReviewAction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "reconciliationResultId" UUID NOT NULL,
    "userId" UUID,
    "action" "ReviewActionType" NOT NULL,
    "previousStatus" "ReviewStatus" NOT NULL,
    "newStatus" "ReviewStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciliationRunId" UUID,

    CONSTRAINT "ReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewAction_reconciliationResultId_idx" ON "ReviewAction"("reconciliationResultId");

-- CreateIndex
CREATE INDEX "ReviewAction_companyId_idx" ON "ReviewAction"("companyId");

-- CreateIndex
CREATE INDEX "ReviewAction_userId_idx" ON "ReviewAction"("userId");

-- CreateIndex
CREATE INDEX "ReviewAction_createdAt_idx" ON "ReviewAction"("createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationResult_reviewStatus_idx" ON "ReconciliationResult"("reviewStatus");

-- AddForeignKey
ALTER TABLE "PartyAlias" ADD CONSTRAINT "PartyAlias_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAction" ADD CONSTRAINT "ReviewAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAction" ADD CONSTRAINT "ReviewAction_reconciliationResultId_fkey" FOREIGN KEY ("reconciliationResultId") REFERENCES "ReconciliationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAction" ADD CONSTRAINT "ReviewAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAction" ADD CONSTRAINT "ReviewAction_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
