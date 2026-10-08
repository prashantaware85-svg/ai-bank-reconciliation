-- AlterTable
ALTER TABLE "TallyTransaction" ADD COLUMN     "identityHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "TallySync" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "tallyCompany" TEXT NOT NULL,
    "bankLedger" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "recordsReceived" INTEGER NOT NULL DEFAULT 0,
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallySync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TallySync_companyId_idx" ON "TallySync"("companyId");

-- CreateIndex
CREATE INDEX "TallySync_connectionId_idx" ON "TallySync"("connectionId");

-- CreateIndex
CREATE INDEX "TallySync_status_idx" ON "TallySync"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TallyTransaction_companyId_identityHash_key" ON "TallyTransaction"("companyId", "identityHash");

-- AddForeignKey
ALTER TABLE "TallySync" ADD CONSTRAINT "TallySync_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallySync" ADD CONSTRAINT "TallySync_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "TallyConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
