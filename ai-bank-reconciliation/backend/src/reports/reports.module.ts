import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService, CompanyQueryGuard],
  exports: [ReportsService],
})
export class ReportsModule {}
