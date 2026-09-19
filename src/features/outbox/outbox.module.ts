import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxDispatcherService } from '@/features/outbox/services/outbox-dispatcher.service';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';

/** 발행 feature는 이 모듈을 import해 OutboxPublisher를 받는다. 소비자는 `@SubscribeOutbox()`로 선언만 하면 된다. */
@Module({
  imports: [DiscoveryModule],
  providers: [OutboxRepository, OutboxPublisher, OutboxDispatcherService],
  exports: [OutboxPublisher],
})
export class OutboxModule {}
