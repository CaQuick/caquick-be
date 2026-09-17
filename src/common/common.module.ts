import { Global, Module } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import { RandomService } from '@/common/providers/random.service';

@Global()
@Module({
  providers: [ClockService, IdGenerator, RandomService],
  exports: [ClockService, IdGenerator, RandomService],
})
export class CommonModule {}
