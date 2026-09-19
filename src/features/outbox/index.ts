// cross-feature 공개 API. 발행은 OutboxPublisher(같은 tx 적재), 소비는 @SubscribeOutbox + OutboxConsumer 계약.
export { OutboxModule } from '@/features/outbox/outbox.module';
export { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
// 테스트 헬퍼(drainOutbox)가 폴링 없이 소비를 돌리기 위해 노출한다.
export { OutboxDispatcherService } from '@/features/outbox/services/outbox-dispatcher.service';
export { SubscribeOutbox } from '@/features/outbox/decorators/subscribe-outbox.decorator';
export type {
  DispatchSummary,
  OutboxConsumer,
  OutboxEvent,
  OutboxEventInput,
} from '@/features/outbox/types/outbox-event.type';
