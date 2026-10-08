-- CreateEnum
CREATE TYPE "AiClassification" AS ENUM ('NO_EXCEPTION', 'WRONG_PARTY_CANDIDATE', 'DUPLICATE_CANDIDATE', 'AMOUNT_ANOMALY', 'DATE_ANOMALY', 'NARRATION_ANOMALY', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "AiRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" UUID NOT NULL,
    "reconciliationResultId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "classification" "AiClassification" NOT NULL,
    "aiConfidence" DECIMAL(5,4) NOT NULL,
    "riskLevel" "AiRiskLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "recommendedAction" TEXT,
    "inputHash" TEXT NOT NULL,
    "deterministicConfidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reconciliationResultLinkId" UUID,

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIAnalysis_reconciliationResultId_idx" ON "AIAnalysis"("reconciliationResultId");

-- CreateIndex
CREATE UNIQUE INDEX "AIAnalysis_reconciliationResultId_promptVersion_model_input_key" ON "AIAnalysis"("reconciliationResultId", "promptVersion", "model", "inputHash");

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_reconciliationResultId_fkey" FOREIGN KEY ("reconciliationResultId") REFERENCES "ReconciliationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_reconciliationResultLinkId_fkey" FOREIGN KEY ("reconciliationResultLinkId") REFERENCES "ReconciliationResultLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
