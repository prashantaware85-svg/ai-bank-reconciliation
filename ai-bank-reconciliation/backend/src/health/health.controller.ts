import { Controller, Get, HttpCode } from '@nestjs/common';
import { HealthService } from './health.service.js';

/**
 * Unauthenticated health endpoints for Docker/K8s probes and load
 * balancers. They expose availability only — never secrets or data.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(200)
  live() {
    return this.health.liveness();
  }

  @Get('ready')
  @HttpCode(200)
  async ready() {
    return this.health.readiness();
  }
}
