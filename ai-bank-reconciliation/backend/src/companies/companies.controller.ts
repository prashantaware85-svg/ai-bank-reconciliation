import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CompaniesService } from './companies.service.js';
import { CompanyMembershipGuard } from './company-membership.guard.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';

interface RequestUser {
  id: string;
}

const WRITE_THROTTLE = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * Company management. `JwtAuthGuard` authenticates; `CompanyMembershipGuard`
 * enforces tenant isolation on `:id` routes (404 for non-members);
 * `RolesGuard` + `@Roles('OWNER')` restrict mutating routes to owners.
 */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle(WRITE_THROTTLE)
  create(@Req() req: { user: RequestUser }, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(req.user.id, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: { user: RequestUser }) {
    return this.companiesService.list(req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, CompanyMembershipGuard, RolesGuard)
  getById(@Req() req: { user: RequestUser }, @Param('id') id: string) {
    return this.companiesService.getById(req.user.id, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, CompanyMembershipGuard, RolesGuard)
  @Roles('OWNER')
  update(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(req.user.id, id, dto);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard, CompanyMembershipGuard, RolesGuard)
  listMembers(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.companiesService.listMembers(req.user.id, id);
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard, CompanyMembershipGuard, RolesGuard)
  @Roles('OWNER')
  @Throttle(WRITE_THROTTLE)
  addMember(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.companiesService.addMember(req.user.id, id, dto);
  }

  @Patch(':id/members/:userId')
  @UseGuards(JwtAuthGuard, CompanyMembershipGuard, RolesGuard)
  @Roles('OWNER')
  changeRole(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.companiesService.changeRole(
      req.user.id,
      id,
      targetUserId,
      dto,
    );
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CompanyMembershipGuard, RolesGuard)
  removeMember(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.companiesService.removeMember(req.user.id, id, targetUserId);
  }
}
