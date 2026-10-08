import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { CompanyQueryDto } from '../bank-accounts/dto/company-query.dto.js';
import { CreateRunDto } from './dto/create-run.dto.js';
import { ResultsQueryDto } from './dto/results-query.dto.js';
import { ReconciliationRunGuard } from './reconciliation-run.guard.js';
import { ReconciliationService } from './reconciliation.service.js';

interface RequestUser {
  id: string;
}

const WRITE_THROTTLE = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * Deterministic reconciliation (read-only analysis). Create/run requires
 * OWNER or ACCOUNTANT; REVIEWER/VIEWER can read runs and results.
 */
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('runs')
  @UseGuards(JwtAuthGuard)
  @Throttle(WRITE_THROTTLE)
  createRun(@Req() req: { user: RequestUser }, @Body() dto: CreateRunDto) {
    // The company is resolved from the bank account inside the service and
    // membership + role are enforced there (never trusted from the client).
    return this.reconciliationService.createRun(req.user.id, dto);
  }

  @Get('runs')
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  listRuns(
    @Req() req: { user: RequestUser },
    @Query() query: CompanyQueryDto,
  ) {
    return this.reconciliationService.listRuns(req.user.id, query.companyId);
  }

  @Get('runs/:id')
  @UseGuards(JwtAuthGuard, ReconciliationRunGuard, RolesGuard)
  getRun(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.reconciliationService.getRun(req.user.id, id);
  }

  @Get('runs/:id/results')
  @UseGuards(JwtAuthGuard, ReconciliationRunGuard, RolesGuard)
  listResults(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Query() query: ResultsQueryDto,
  ) {
    return this.reconciliationService.listResults(req.user.id, id, query);
  }}
