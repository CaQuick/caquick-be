import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { OrderStoreDailyLimitRepository } from '@/features/order/repositories/order-store-daily-limit.repository';
import {
  type OutboxConsumer,
  type OutboxEvent,
  SubscribeOutbox,
} from '@/features/outbox';
import {
  parseStoreDailyCapacityChangedPayload,
  STORE_DAILY_CAPACITY_CHANGED,
} from '@/features/store';

/** catalog의 일일 capacity 변경을 order 복제본에 반영한다. 멱등: 원본 updated_at 기준으로 오래된 이벤트는 무시. */
@Injectable()
@SubscribeOutbox(STORE_DAILY_CAPACITY_CHANGED)
export class OrderStoreDailyLimitConsumer implements OutboxConsumer {
  constructor(private readonly repo: OrderStoreDailyLimitRepository) {}

  async handle(event: OutboxEvent): Promise<void> {
    const p = parseStoreDailyCapacityChangedPayload(event.payload);
    await this.repo.applyCapacityChange({
      storeId: parseId(p.storeId),
      bookingDate: new Date(`${p.capacityDate}T00:00:00.000Z`),
      capacity: p.capacity,
      sourceUpdatedAt: new Date(p.updatedAt),
    });
  }
}
