import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { NOTIFICATION_FANOUT_BATCH_SIZE } from '@/features/notification/constants/notification-admin.constants';
import {
  NOTIFICATION_BROADCAST_REQUESTED,
  parseNotificationBroadcastRequestedPayload,
} from '@/features/notification/events/notification-broadcast-requested.event';
import {
  type NotificationEventRow,
  NotificationRepository,
} from '@/features/notification/repositories/notification.repository';
import {
  buildOrderStatusNotification,
  buildReviewLikedNotification,
} from '@/features/notification/services/notification-payloads.helper';
import {
  ORDER_STATUS_CHANGED,
  parseOrderStatusChangedPayload,
} from '@/features/order';
import {
  type OutboxConsumer,
  type OutboxEvent,
  SubscribeOutbox,
} from '@/features/outbox';
import { parseReviewLikedPayload, REVIEW_LIKED } from '@/features/review';

/**
 * 알림 생성의 단일 진입점(outbox 소비자). 전달은 at-least-once라 (source_event_id, account_id) unique + skipDuplicates로
 * 재전달을 흡수한다. created_at은 이벤트 발생 시각(occurred_at)이다.
 */
@Injectable()
@SubscribeOutbox(
  ORDER_STATUS_CHANGED,
  REVIEW_LIKED,
  NOTIFICATION_BROADCAST_REQUESTED,
)
export class NotificationOutboxConsumer implements OutboxConsumer {
  constructor(private readonly repo: NotificationRepository) {}

  async handle(event: OutboxEvent): Promise<void> {
    switch (event.eventType) {
      case ORDER_STATUS_CHANGED:
        return this.onOrderStatusChanged(event);
      case REVIEW_LIKED:
        return this.onReviewLiked(event);
      case NOTIFICATION_BROADCAST_REQUESTED:
        return this.onBroadcastRequested(event);
      default:
        throw new Error(`구독하지 않은 outbox 이벤트: ${event.eventType}`);
    }
  }

  private async onOrderStatusChanged(event: OutboxEvent): Promise<void> {
    const p = parseOrderStatusChangedPayload(event.payload);
    // SUBMITTED 등 알림 대상이 아닌 전이는 payload가 null — 이벤트는 정상 소비된다
    const payload = buildOrderStatusNotification(p.orderNumber, p.toStatus);
    if (!payload) return;
    await this.repo.createFromEvent(event.eventId, [
      {
        account_id: parseId(p.buyerAccountId),
        ...payload,
        order_id: parseId(p.orderId),
        store_id: p.storeId === null ? null : parseId(p.storeId),
        product_id: p.productId === null ? null : parseId(p.productId),
        order_number: p.orderNumber,
        store_name: p.storeName,
        product_name: p.productName,
        created_at: event.occurredAt,
      },
    ]);
  }

  private async onReviewLiked(event: OutboxEvent): Promise<void> {
    const p = parseReviewLikedPayload(event.payload);
    await this.repo.createFromEvent(event.eventId, [
      {
        account_id: parseId(p.authorAccountId),
        ...buildReviewLikedNotification(),
        review_id: parseId(p.reviewId),
        store_id: parseId(p.storeId),
        product_id: parseId(p.productId),
        store_name: p.storeName,
        product_name: p.productName,
        created_at: event.occurredAt,
      },
    ]);
  }

  /** 대상은 요청 시점에 확정된 목록 — 청크 단위로 넣고, 재전달 시 이미 들어간 계정은 unique로 건너뛴다. */
  private async onBroadcastRequested(event: OutboxEvent): Promise<void> {
    const p = parseNotificationBroadcastRequestedPayload(event.payload);
    for (
      let offset = 0;
      offset < p.targetAccountIds.length;
      offset += NOTIFICATION_FANOUT_BATCH_SIZE
    ) {
      const rows: NotificationEventRow[] = p.targetAccountIds
        .slice(offset, offset + NOTIFICATION_FANOUT_BATCH_SIZE)
        .map((id) => ({
          account_id: parseId(id),
          type: p.type,
          event: null,
          title: p.title,
          body: p.body,
          created_at: event.occurredAt,
        }));
      await this.repo.createFromEvent(event.eventId, rows);
    }
  }
}
