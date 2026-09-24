import { Injectable } from '@nestjs/common';

import {
  HEALTH_CHECK_TIMEOUT_MS,
  type HealthIndicator,
} from '@/common/ports/health-indicator.port';
import { withTimeout } from '@/common/utils/with-timeout';
import { PrismaService } from '@/prisma';

/** 커넥션 풀을 실제로 지나는 최소 쿼리 — 풀 고갈·인증 실패·DB 정지를 모두 드러낸다. */
@Injectable()
export class HealthRepository implements HealthIndicator {
  readonly name = 'mysql';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    await withTimeout(
      this.prisma.$queryRaw`SELECT 1`,
      HEALTH_CHECK_TIMEOUT_MS,
      'mysql SELECT 1',
    );
  }
}
