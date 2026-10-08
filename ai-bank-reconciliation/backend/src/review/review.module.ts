import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { ReconciliationResultGuard } from '../ai/reconciliation-result.guard.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReconciliationResultGuard, CompanyQueryGuard],
  exports: [ReviewService],
})
export class ReviewModule {}
