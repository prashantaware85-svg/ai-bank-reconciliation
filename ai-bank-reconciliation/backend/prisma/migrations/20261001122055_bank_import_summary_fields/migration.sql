-- AlterTable
ALTER TABLE "BankImport" ADD COLUMN     "skippedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" JSONB;
