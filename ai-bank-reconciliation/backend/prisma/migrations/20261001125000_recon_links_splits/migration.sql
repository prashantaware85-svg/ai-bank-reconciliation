-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'DUPLICATE_CANDIDATE');

-- CreateEnum
CREATE TYPE "LinkSide" AS ENUM ('BANK', 'TALLY');

-- AlterTable
ALTER TABLE "ReconciliationResult" ADD COLUMN     "bankTotal" DECIMAL(19,2),
ADD COLUMN     "matchType" "MatchType" NOT NULL DEFAULT 'ONE_TO_ONE',
ADD COLUMN     "tallyTotal" DECIMAL(19,2);

-- CreateTable
CREATE TABLE "ReconciliationResultLink" (
    "id" UUID NOT NULL,
    "reconciliationResultId" UUID NOT NULL,
    "side" "LinkSide" NOT NULL,
    "bankTransactionId" UUID,
    "tallyTransactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationResultLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationResultLink_reconciliationResultId_idx" ON "ReconciliationResultLink"("reconciliationResultId");

-- CreateIndex
CREATE INDEX "ReconciliationResultLink_bankTransactionId_idx" ON "ReconciliationResultLink"("bankTransactionId");

-- CreateIndex
CREATE INDEX "ReconciliationResultLink_tallyTransactionId_idx" ON "ReconciliationResultLink"("tallyTransactionId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_matchType_idx" ON "ReconciliationResult"("matchType");

-- AddForeignKey
ALTER TABLE "ReconciliationResultLink" ADD CONSTRAINT "ReconciliationResultLink_reconciliationResultId_fkey" FOREIGN KEY ("reconciliationResultId") REFERENCES "ReconciliationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResultLink" ADD CONSTRAINT "ReconciliationResultLink_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResultLink" ADD CONSTRAINT "ReconciliationResultLink_tallyTransactionId_fkey" FOREIGN KEY ("tallyTransactionId") REFERENCES "TallyTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
