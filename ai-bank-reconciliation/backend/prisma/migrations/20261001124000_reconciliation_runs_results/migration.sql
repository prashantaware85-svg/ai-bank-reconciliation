-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'POSSIBLE_MATCH', 'UNMATCHED', 'AMOUNT_MISMATCH', 'DATE_MISMATCH', 'MISSING_IN_TALLY', 'MISSING_IN_BANK', 'REVIEW_REQUIRED');

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "dateToleranceDays" INTEGER NOT NULL DEFAULT 2,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalBankTransactions" INTEGER NOT NULL DEFAULT 0,
    "totalTallyTransactions" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "possibleMatchCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "exceptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" UUID,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationResult" (
    "id" UUID NOT NULL,
    "reconciliationRunId" UUID NOT NULL,
    "bankTransactionId" UUID,
    "tallyTransactionId" UUID,
    "matchStatus" "ReconciliationStatus" NOT NULL,
    "confidence" INTEGER,
    "amountDifference" DECIMAL(19,2),
    "dateDifferenceDays" INTEGER,
    "matchReason" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationRun_companyId_idx" ON "ReconciliationRun"("companyId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_bankAccountId_idx" ON "ReconciliationRun"("bankAccountId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_status_idx" ON "ReconciliationRun"("status");

-- CreateIndex
CREATE INDEX "ReconciliationRun_createdAt_idx" ON "ReconciliationRun"("createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationResult_reconciliationRunId_idx" ON "ReconciliationResult"("reconciliationRunId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_bankTransactionId_idx" ON "ReconciliationResult"("bankTransactionId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_tallyTransactionId_idx" ON "ReconciliationResult"("tallyTransactionId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_matchStatus_idx" ON "ReconciliationResult"("matchStatus");

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_reconciliationRunId_fkey" FOREIGN KEY ("reconciliationRunId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_tallyTransactionId_fkey" FOREIGN KEY ("tallyTransactionId") REFERENCES "TallyTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
