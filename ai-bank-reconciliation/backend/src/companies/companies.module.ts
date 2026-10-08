import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompanyMembershipGuard } from './company-membership.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyMembershipGuard],
  exports: [CompaniesService, CompanyMembershipGuard],
})
export class CompaniesModule {}
