import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { NOTIFICATION_FANOUT_BATCH_SIZE } from '@/features/notification/constants/notification-admin.constants';
import {
  NOTIFICATION_BROADCAST_REQUESTED,
  parseNotificationBroadcastRequestedPayload,
} from '@/features/notification/events/notification-broadcast-requested.event';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
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
  constructor(
    private readonly repo: NotificationRepository,
    private readonly audience: NotificationAdminRepository,
  ) {}

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

  /**
   * ACCOUNT_IDS는 확정 목록을, ALL_USERS는 요청 시점 컷오프 이하 활성 USER를 키셋 페이지로 훑어 청크 단위로 넣는다.
   * 재전달 시 이미 들어간 계정은 createFromEvent가 건너뛴다(청크 중간 실패 뒤 재시도도 안전).
   */
  private async onBroadcastRequested(event: OutboxEvent): Promise<void> {
    const p = parseNotificationBroadcastRequestedPayload(event.payload);
    const toRows = (ids: bigint[]): NotificationEventRow[] =>
      ids.map((account_id) => ({
        account_id,
        type: p.type,
        event: null,
        title: p.title,
        body: p.body,
        created_at: event.occurredAt,
      }));
    if (p.audience.kind === 'ACCOUNT_IDS') {
      const ids = p.audience.accountIds.map(parseId);
      for (let i = 0; i < ids.length; i += NOTIFICATION_FANOUT_BATCH_SIZE) {
        await this.repo.createFromEvent(
          event.eventId,
          toRows(ids.slice(i, i + NOTIFICATION_FANOUT_BATCH_SIZE)),
        );
      }
      return;
    }
    const maxId = parseId(p.audience.maxAccountId);
    let afterId: bigint | undefined;
    for (;;) {
      const ids = await this.audience.listActiveUserAccountIds({
        afterId,
        maxId,
        limit: NOTIFICATION_FANOUT_BATCH_SIZE,
      });
      if (ids.length === 0) return;
      await this.repo.createFromEvent(event.eventId, toRows(ids));
      if (ids.length < NOTIFICATION_FANOUT_BATCH_SIZE) return;
      afterId = ids[ids.length - 1];
    }
  }
}
