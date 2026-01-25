import { Global, Module } from '@nestjs/common';

import { DateTimeScalar } from './scalars/date-time.scalar';

/**
 * GraphQL 전역 모듈
 */
@Global()
@Module({
  providers: [DateTimeScalar],
  exports: [DateTimeScalar],
})
export class GraphqlGlobalModule {}
