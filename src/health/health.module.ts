import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * 헬스 체크 모듈.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
