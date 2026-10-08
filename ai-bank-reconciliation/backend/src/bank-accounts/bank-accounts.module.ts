import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BankAccountGuard } from './bank-account.guard.js';
import { BankAccountsController } from './bank-accounts.controller.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { BankImportGuard } from './bank-import.guard.js';
import { BankImportsController } from './bank-imports.controller.js';
import { BankImportsService } from './bank-imports.service.js';
import { CompanyQueryGuard } from './company-query.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [BankAccountsController, BankImportsController],
  providers: [
    BankAccountsService,
    BankImportsService,
    BankAccountGuard,
    BankImportGuard,
    CompanyQueryGuard,
  ],
  exports: [BankAccountsService, BankImportsService],
})
export class BankAccountsModule {}
