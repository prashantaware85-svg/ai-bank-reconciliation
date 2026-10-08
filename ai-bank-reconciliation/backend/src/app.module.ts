import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiAnalysisModule } from './ai/ai-analysis.module.js';
import { HttpExceptionLoggingFilter } from './common/http-exception-logging.filter.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { HealthModule } from './health/health.module.js';
import { validateEnv } from './config/env.validation.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReviewModule } from './review/review.module.js';
import { TallyModule } from './tally/tally.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Global rate-limit structure: 100 req/min per IP. Auth endpoints
    // apply stricter per-route limits. A Redis store can back this later.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    AuthModule,
    CompaniesModule,
    BankAccountsModule,
    TallyModule,
    ReconciliationModule,
    AiAnalysisModule,
    ReportsModule,
    ReviewModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Step 17: centralized error logging (response formats unchanged).
    { provide: APP_FILTER, useClass: HttpExceptionLoggingFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Step 16: request-ID correlation on every route (no behavior change).
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
