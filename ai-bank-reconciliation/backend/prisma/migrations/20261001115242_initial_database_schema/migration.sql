-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'ACCOUNTANT', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TallyConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "financialYear" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyUser" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "ifsc" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImport" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "description" TEXT,
    "narration" TEXT,
    "chequeNumber" TEXT,
    "reference" TEXT,
    "debit" DECIMAL(19,2),
    "credit" DECIMAL(19,2),
    "amount" DECIMAL(19,2) NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "balance" DECIMAL(19,2),
    "originalRow" JSONB NOT NULL,
    "normalizedNarration" TEXT,
    "normalizedReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyConnection" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TallyConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "connectorId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyTransaction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" TEXT,
    "voucherNo" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "ledger" TEXT,
    "bankLedger" TEXT,
    "voucherType" TEXT,
    "direction" "TransactionDirection" NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "reference" TEXT,
    "narration" TEXT,
    "party" TEXT,
    "normalizedParty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyAlias" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "canonicalParty" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_gstin_key" ON "Company"("gstin");

-- CreateIndex
CREATE INDEX "Company_companyName_idx" ON "Company"("companyName");

-- CreateIndex
CREATE INDEX "CompanyUser_userId_idx" ON "CompanyUser"("userId");

-- CreateIndex
CREATE INDEX "CompanyUser_companyId_idx" ON "CompanyUser"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyUser_userId_companyId_key" ON "CompanyUser"("userId", "companyId");

-- CreateIndex
CREATE INDEX "BankAccount_companyId_idx" ON "BankAccount"("companyId");

-- CreateIndex
CREATE INDEX "BankAccount_bankName_idx" ON "BankAccount"("bankName");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_companyId_accountName_key" ON "BankAccount"("companyId", "accountName");

-- CreateIndex
CREATE INDEX "BankImport_companyId_idx" ON "BankImport"("companyId");

-- CreateIndex
CREATE INDEX "BankImport_bankAccountId_idx" ON "BankImport"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankImport_status_idx" ON "BankImport"("status");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_idx" ON "BankTransaction"("companyId");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_idx" ON "BankTransaction"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_importId_idx" ON "BankTransaction"("importId");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_reference_idx" ON "BankTransaction"("reference");

-- CreateIndex
CREATE INDEX "BankTransaction_normalizedReference_idx" ON "BankTransaction"("normalizedReference");

-- CreateIndex
CREATE INDEX "BankTransaction_amount_idx" ON "BankTransaction"("amount");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_transactionDate_idx" ON "BankTransaction"("companyId", "transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_companyId_amount_idx" ON "BankTransaction"("companyId", "amount");

-- CreateIndex
CREATE INDEX "TallyConnection_companyId_idx" ON "TallyConnection"("companyId");

-- CreateIndex
CREATE INDEX "TallyConnection_status_idx" ON "TallyConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TallyConnection_companyId_name_key" ON "TallyConnection"("companyId", "name");

-- CreateIndex
CREATE INDEX "TallyTransaction_companyId_idx" ON "TallyTransaction"("companyId");

-- CreateIndex
CREATE INDEX "TallyTransaction_voucherId_idx" ON "TallyTransaction"("voucherId");

-- CreateIndex
CREATE INDEX "TallyTransaction_voucherNo_idx" ON "TallyTransaction"("voucherNo");

-- CreateIndex
CREATE INDEX "TallyTransaction_date_idx" ON "TallyTransaction"("date");

-- CreateIndex
CREATE INDEX "TallyTransaction_reference_idx" ON "TallyTransaction"("reference");

-- CreateIndex
CREATE INDEX "TallyTransaction_normalizedParty_idx" ON "TallyTransaction"("normalizedParty");

-- CreateIndex
CREATE INDEX "TallyTransaction_amount_idx" ON "TallyTransaction"("amount");

-- CreateIndex
CREATE INDEX "TallyTransaction_companyId_date_idx" ON "TallyTransaction"("companyId", "date");

-- CreateIndex
CREATE INDEX "TallyTransaction_companyId_amount_idx" ON "TallyTransaction"("companyId", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PartyAlias_companyId_idx" ON "PartyAlias"("companyId");

-- CreateIndex
CREATE INDEX "PartyAlias_normalizedAlias_idx" ON "PartyAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "PartyAlias_canonicalParty_idx" ON "PartyAlias"("canonicalParty");

-- CreateIndex
CREATE UNIQUE INDEX "PartyAlias_companyId_normalizedAlias_key" ON "PartyAlias"("companyId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "CompanyUser" ADD CONSTRAINT "CompanyUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyUser" ADD CONSTRAINT "CompanyUser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImport" ADD CONSTRAINT "BankImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImport" ADD CONSTRAINT "BankImport_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyConnection" ADD CONSTRAINT "TallyConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyTransaction" ADD CONSTRAINT "TallyTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAlias" ADD CONSTRAINT "PartyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
