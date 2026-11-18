import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PubSubEngine } from 'graphql-subscriptions';

import type { AdminOrderRow } from '@/features/order/repositories/order.repository';
import { toSellerOrderUpdateEvent } from '@/features/order/services/order-events-mappers.helper';
import type { SellerOrderUpdateEvent } from '@/features/order/types/order-seller-output.type';
import { PUB_SUB } from '@/global/pubsub';

/** 토픽 문자열은 여기서만 조립한다 — 발행자(입금 확인·판매자 상태 변경·관리자 취소)와 구독 리졸버가 같은 토픽을 보는 단일 소스. */
@Injectable()
export class OrderEventsService {
  private readonly logger = new Logger(OrderEventsService.name);

  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSubEngine) {}

  /**
   * 발행은 DB 커밋 이후의 부수효과 — Redis 장애가 이미 성공한 주문을 실패로 둔갑시키면 클라이언트 재시도로
   * 중복 주문이 난다. 실패는 경고 로그만 남기고 삼킨다(구독자는 sellerOrderList 재조회 폴백).
   */
  private async safePublish(topic: string, payload: unknown): Promise<void> {
    try {
      await this.pubSub.publish(topic, payload);
    } catch (e) {
      this.logger.warn(
        `subscription publish 실패 (topic=${topic}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private sellerTopic(storeId: bigint): string {
    return `order.seller.${storeId}`;
  }

  async publishSellerOrderUpdate(
    storeId: bigint,
    event: SellerOrderUpdateEvent,
  ): Promise<void> {
    await this.safePublish(this.sellerTopic(storeId), event);
  }

  /** 입금 확인 전 주문은 판매자에게 보이지 않고, 활성 품목이 없으면 매장을 알 수 없어 발행하지 않는다. */
  async publishSellerStatusChanged(row: AdminOrderRow): Promise<void> {
    const [firstItem] = row.items;
    if (!firstItem || !row.submitted_at) return;
    await this.publishSellerOrderUpdate(
      firstItem.store_id,
      toSellerOrderUpdateEvent('STATUS_CHANGED', row),
    );
  }

  sellerOrderIterator(storeId: bigint): AsyncIterator<unknown> {
    return this.pubSub.asyncIterableIterator(this.sellerTopic(storeId));
  }
}
