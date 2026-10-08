import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReconciliationResultGuard } from '../ai/reconciliation-result.guard.js';
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { ReviewActionDto } from './dto/review-action.dto.js';
import { CreateAliasDto } from './dto/review-filter.dto.js';
import { ReviewService } from './review.service.js';

interface RequestUser {
  id: string;
}

const WRITE_THROTTLE = { default: { limit: 30, ttl: 60_000 } } as const;

/**
 * Human review + party alias APIs. Review: OWNER/ACCOUNTANT/REVIEWER;
 * alias create/approve: OWNER/ACCOUNTANT; VIEWER read-only.
 */
@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get('reconciliation/results/:id/review')
  @UseGuards(JwtAuthGuard, ReconciliationResultGuard, RolesGuard)
  getReview(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.reviewService.getReview(req.user.id, id);
  }

  @Post('reconciliation/results/:id/review')
  @UseGuards(JwtAuthGuard, ReconciliationResultGuard, RolesGuard)
  @Throttle(WRITE_THROTTLE)
  reviewAction(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.reviewService.reviewAction(req.user.id, id, dto);
  }

  @Post('party-aliases')
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(WRITE_THROTTLE)
  createAlias(
    @Req() req: { user: RequestUser },
    @Query() query: { companyId: string },
    @Body() dto: CreateAliasDto,
  ) {
    return this.reviewService.createAlias(req.user.id, query.companyId, dto);
  }

  @Get('party-aliases')
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  listAliases(
    @Req() req: { user: RequestUser },
    @Query() query: { companyId: string },
  ) {
    return this.reviewService.listAliases(req.user.id, query.companyId);
  }

  @Patch('party-aliases/:id/approve')
  @UseGuards(JwtAuthGuard)
  @Throttle(WRITE_THROTTLE)
  approveAlias(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    // Company + role verified inside the service via the alias's company.
    return this.reviewService.approveAlias(req.user.id, id);
  }
}
