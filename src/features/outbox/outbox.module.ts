import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import { RabbitHealthIndicator } from '@/features/outbox/rabbitmq/rabbit-health.indicator';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxDispatcherService } from '@/features/outbox/services/outbox-dispatcher.service';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import { OutboxRelayService } from '@/features/outbox/services/outbox-relay.service';
import { RabbitConsumerHostService } from '@/features/outbox/services/rabbit-consumer-host.service';

/**
 * 발행 feature는 이 모듈을 import해 OutboxPublisher를 받는다. 소비자는 `@SubscribeOutbox()`로 선언만 하면 된다.
 * 운영 전달은 릴레이(outbox → RabbitMQ)와 소비자 호스트가 worker에서 맡는다. 디스패처는 테스트 전용 직접 전달.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    OutboxRepository,
    OutboxPublisher,
    OutboxDispatcherService,
    OutboxConsumerRegistry,
    RabbitConnectionService,
    RabbitHealthIndicator,
    OutboxRelayService,
    RabbitConsumerHostService,
  ],
  exports: [OutboxPublisher, RabbitHealthIndicator],
})
export class OutboxModule {}
