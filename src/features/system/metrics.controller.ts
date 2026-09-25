import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { MetricsService } from '@/global/metrics';

/** Prometheus 스크레이프 대상(P2 05). 형식이 표준이라 전역 봉투 제외 목록에 있다. worker 리스너도 이 경로는 연다. 접근은 MetricsAccessMiddleware(Bearer 토큰). */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res({ passthrough: true }) res: Response): Promise<string> {
    // collect는 던지지 않게 격리돼 있지만, 본문을 다 만든 뒤에 헤더를 건다
    const body = await this.metrics.text();
    res.setHeader('content-type', this.metrics.contentType);
    return body;
  }
}
