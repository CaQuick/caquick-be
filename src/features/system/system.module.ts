import { Module } from '@nestjs/common';

import { HealthController } from '@/features/system/health.controller';
import { PingResolver } from '@/features/system/resolvers/ping.resolver';

/**
 * 시스템 관련 기능을 묶는 모듈.
 */
@Module({
  controllers: [HealthController],
  providers: [PingResolver],
})
export class SystemModule {}
