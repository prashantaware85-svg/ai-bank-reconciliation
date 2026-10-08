import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BankAccountGuard } from './bank-account.guard.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { BankImportsService } from './bank-imports.service.js';
import { CompanyQueryGuard } from './company-query.guard.js';
import { CompanyQueryDto } from './dto/company-query.dto.js';
import { ConfirmImportDto } from './dto/confirm-import.dto.js';
import { CreateBankAccountDto } from './dto/create-bank-account.dto.js';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto.js';
import { MAX_FILE_BYTES } from './statement/statement-parser.js';

interface RequestUser {
  id: string;
}

const WRITE_THROTTLE = { default: { limit: 20, ttl: 60_000 } } as const;

const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
};

/**
 * Bank accounts + statement import. `CompanyQueryGuard` scopes collection
 * routes to `?companyId=`; `BankAccountGuard` scopes item/import routes to
 * the account's company. Writes require OWNER or ACCOUNTANT.
 */
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(
    private readonly accountsService: BankAccountsService,
    private readonly importsService: BankImportsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(WRITE_THROTTLE)
  create(
    @Req() req: { user: RequestUser },
    @Query() query: CompanyQueryDto,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.accountsService.create(req.user.id, query.companyId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  list(
    @Req() req: { user: RequestUser },
    @Query() query: CompanyQueryDto,
  ) {
    return this.accountsService.list(req.user.id, query.companyId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, BankAccountGuard, RolesGuard)
  getById(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.accountsService.getById(req.user.id, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, BankAccountGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  update(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.accountsService.update(req.user.id, id, dto);
  }

  @Post(':bankAccountId/import/preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, BankAccountGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  preview(
    @Req() req: { user: RequestUser },
    @Param('bankAccountId') bankAccountId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.importsService.preview(req.user.id, bankAccountId, file);
  }

  @Post(':bankAccountId/import')
  @UseGuards(JwtAuthGuard, BankAccountGuard, RolesGuard)
  @Roles('OWNER', 'ACCOUNTANT')
  @Throttle(WRITE_THROTTLE)
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  confirm(
    @Req() req: { user: RequestUser },
    @Param('bankAccountId') bankAccountId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.importsService.confirm(req.user.id, bankAccountId, file, dto);
  }
}
