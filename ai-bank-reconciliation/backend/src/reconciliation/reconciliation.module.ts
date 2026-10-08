import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationRunGuard } from './reconciliation-run.guard.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    ReconciliationRunGuard,
    CompanyQueryGuard,
  ],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
