import { Global, Module } from '@nestjs/common';

import { DateTimeScalar } from '@/global/graphql/scalars/date-time.scalar';

@Global()
@Module({
  providers: [DateTimeScalar],
  exports: [DateTimeScalar],
})
export class GraphqlGlobalModule {}
