import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthService } from '@/features/system/services/health.service';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 프로세스가 요청을 받는지만 본다(의존성 무관). 옛 `/health`와 같은 의미라 그 경로도 유지한다. */
  @Get()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('live')
  getLive() {
    return { status: 'ok' };
  }

  /** 의존성(MySQL·Redis, 04부터 RabbitMQ)까지 본다. compose healthcheck·트래픽 투입 판단은 이 경로로. */
  @Get('ready')
  async getReady(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.ready();
    res.status(result.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: result.ok ? 'ok' : 'degraded', checks: result.checks };
  }

  @Get('profiles')
  getProfiles() {
    return {
      status: 'ok',
      profile: process.env.PROFILE ?? 'unknown',
      port: process.env.PORT,
    };
  }
}
