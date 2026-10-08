import {
  Body,
  Controller,
  Delete,
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
import { CompanyQueryGuard } from '../bank-accounts/company-query.guard.js';
import { CompanyQueryDto } from '../bank-accounts/dto/company-query.dto.js';
import { FailSyncDto } from './dto/fail-sync.dto.js';
import { IngestSyncDto } from './dto/ingest-sync.dto.js';
import { CreateConnectionDto } from './dto/create-connection.dto.js';
import { StartSyncDto } from './dto/start-sync.dto.js';
import { TallyConnectionGuard } from './tally-connection.guard.js';
import { TallySyncGuard } from './tally-sync.guard.js';
import { TallySyncService } from './tally-sync.service.js';
import { TallyService } from './tally.service.js';

interface RequestUser {
  id: string;
}

const WRITE_THROTTLE = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * Tally connections + sync runs. Read-only with respect to TallyPrime:
 * data only ever flows agent → backend → PostgreSQL, never back.
 */
@Controller('tally')
export class TallyController {
  constructor(
    private readonly tallyService: TallyService,
    private readonly syncService: TallySyncService,
  ) {}

  @Post('connections')
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(WRITE_THROTTLE)
  createConnection(
    @Req() req: { user: RequestUser },
    @Query() query: CompanyQueryDto,
    @Body() dto: CreateConnectionDto,
  ) {
    return this.tallyService.create(req.user.id, query.companyId, dto);
  }

  @Get('connections')
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  listConnections(
    @Req() req: { user: RequestUser },
    @Query() query: CompanyQueryDto,
  ) {
    return this.tallyService.list(req.user.id, query.companyId);
  }

  @Get('connections/:id')
  @UseGuards(JwtAuthGuard, TallyConnectionGuard, RolesGuard)
  getConnection(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.tallyService.getById(req.user.id, id);
  }

  @Delete('connections/:id')
  @UseGuards(JwtAuthGuard, TallyConnectionGuard, RolesGuard)
  @Roles('OWNER')
  removeConnection(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.tallyService.remove(req.user.id, id);
  }

  @Get('connections/:id/status')
  @UseGuards(JwtAuthGuard, TallyConnectionGuard, RolesGuard)
  getStatus(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.tallyService.getStatus(req.user.id, id);
  }

  @Post('connections/:id/sync')
  @UseGuards(JwtAuthGuard, TallyConnectionGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(WRITE_THROTTLE)
  startSync(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: StartSyncDto,
  ) {
    return this.syncService.start(req.user.id, id, dto);
  }

  @Get('sync/pending')
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  pendingSyncs(
    @Req() req: { user: RequestUser },
    @Query() query: CompanyQueryDto,
  ) {
    return this.syncService.pending(req.user.id, query.companyId);
  }

  @Get('sync/:syncId')
  @UseGuards(JwtAuthGuard, TallySyncGuard, RolesGuard)
  getSync(@Req() req: { user: RequestUser }, @Param('syncId') syncId: string) {
    return this.syncService.getById(req.user.id, syncId);
  }

  @Post('sync/:syncId/ingest')
  @UseGuards(JwtAuthGuard, TallySyncGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  ingest(
    @Req() req: { user: RequestUser },
    @Param('syncId') syncId: string,
    @Body() dto: IngestSyncDto,
  ) {
    return this.syncService.ingest(req.user.id, syncId, dto);
  }

  @Patch('sync/:syncId/fail')
  @UseGuards(JwtAuthGuard, TallySyncGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  failSync(
    @Req() req: { user: RequestUser },
    @Param('syncId') syncId: string,
    @Body() dto: FailSyncDto,
  ) {
    return this.syncService.fail(req.user.id, syncId, dto.errorMessage);
  }
}
