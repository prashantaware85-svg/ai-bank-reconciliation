import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReconciliationRunGuard } from '../reconciliation/reconciliation-run.guard.js';
import { ReconciliationResultGuard } from './reconciliation-result.guard.js';
import { AiAnalysisService } from './ai-analysis.service.js';

interface RequestUser {
  id: string;
}

const AI_THROTTLE = { default: { limit: 30, ttl: 60_000 } } as const;

/**
 * AI analysis APIs (advisory only). Analysis happens ONLY on explicit
 * user action (POST). AI never alters reconciliation status.
 */
@Controller('reconciliation')
export class AiAnalysisController {
  constructor(private readonly aiAnalysisService: AiAnalysisService) {}

  @Post('results/:id/analyze')
  @UseGuards(JwtAuthGuard, ReconciliationResultGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(AI_THROTTLE)
  analyze(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.aiAnalysisService.analyzeResult(req.user.id, id);
  }

  @Get('results/:id/ai-analysis')
  @UseGuards(JwtAuthGuard, ReconciliationResultGuard, RolesGuard)
  getAnalysis(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.aiAnalysisService.getLatest(req.user.id, id);
  }

  @Post('runs/:id/analyze')
  @UseGuards(JwtAuthGuard, ReconciliationRunGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(AI_THROTTLE)
  analyzeBatch(@Req() req: { user: RequestUser }, @Param('id') id: string, @Body() body: unknown) {
    // Bounded: max 25 exception results per call (see service). Body is
    // intentionally ignored — no uncontrolled batch sizes.
    void body;
    return this.aiAnalysisService.analyzeBatch(req.user.id, id);
  }
}
