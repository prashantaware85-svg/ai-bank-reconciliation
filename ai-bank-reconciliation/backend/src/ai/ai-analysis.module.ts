import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReconciliationRunGuard } from '../reconciliation/reconciliation-run.guard.js';
import { AiAnalysisController } from './ai-analysis.controller.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import { ReconciliationResultGuard } from './reconciliation-result.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [AiAnalysisController],
  providers: [AiAnalysisService, ReconciliationResultGuard, ReconciliationRunGuard],
  exports: [AiAnalysisService],
})
export class AiAnalysisModule {}
