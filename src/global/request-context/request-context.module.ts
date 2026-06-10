import { Global, Module } from '@nestjs/common';

import { RequestContextService } from '@/global/request-context/request-context.service';

/**
 * 요청 컨텍스트(ALS) 전역 모듈.
 *
 * `RequestContextService` 를 전역 export 하여 어느 feature 에서도 주입받을 수 있게 한다.
 * 미들웨어 적용은 `AppModule.configure()` 가 담당한다.
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
