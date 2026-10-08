import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { TallyConnectionGuard } from './tally-connection.guard.js';
import { TallySyncGuard } from './tally-sync.guard.js';
import { TallyController } from './tally.controller.js';
import { TallySyncService } from './tally-sync.service.js';
import { TallyService } from './tally.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TallyController],
  providers: [
    TallyService,
    TallySyncService,
    TallyConnectionGuard,
    TallySyncGuard,
    CompanyQueryGuard,
  ],
  exports: [TallyService, TallySyncService],
})
export class TallyModule {}
