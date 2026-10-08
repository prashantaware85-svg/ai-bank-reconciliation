import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BankImportGuard } from './bank-import.guard.js';
import { BankImportsService } from './bank-imports.service.js';
import { CompanyQueryGuard } from './company-query.guard.js';
import { ListImportsQueryDto } from './dto/list-imports-query.dto.js';

interface RequestUser {
  id: string;
}

/** Read-only import history. Writes happen via BankAccountsController. */
@Controller('bank-imports')
export class BankImportsController {
  constructor(private readonly importsService: BankImportsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, CompanyQueryGuard, RolesGuard)
  list(
    @Req() req: { user: RequestUser },
    @Query() query: ListImportsQueryDto,
  ) {
    return this.importsService.listImports(
      req.user.id,
      query.companyId,
      query.bankAccountId,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, BankImportGuard, RolesGuard)
  getById(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.importsService.getImport(req.user.id, id);
  }

  @Get(':id/transactions')
  @UseGuards(JwtAuthGuard, BankImportGuard, RolesGuard)
  listTransactions(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.importsService.listTransactions(
      req.user.id,
      id,
      limit,
      offset,
    );
  }
}
