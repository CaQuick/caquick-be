import { Global, Module } from '@nestjs/common';

import { RequestContextService } from '@/global/request-context/request-context.service';

/** 미들웨어 적용은 AppModule.configure()가 담당한다. */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
