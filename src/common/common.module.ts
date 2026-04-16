import { Global, Module } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';

/**
 * 전역 공통 provider를 묶는 모듈.
 *
 * - ClockService: 현재 시각 추상화 (테스트 주입용)
 * - IdGenerator: UUID 등 식별자 생성 추상화 (테스트 주입용)
 */
@Global()
@Module({
  providers: [ClockService, IdGenerator],
  exports: [ClockService, IdGenerator],
})
export class CommonModule {}
