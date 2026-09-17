import { Injectable } from '@nestjs/common';

import { RANKING_VALID_ORDER_STATUSES } from '@/features/store/constants/store-ranking.constants';
import { activeWhere, PrismaService } from '@/prisma';

/** 집계 키. 매장 랭킹은 store_id, 상품 랭킹·판매 Best·판매순 정렬은 product_id. */
export type OrderStatsKey = 'store_id' | 'product_id';

/**
 * 주문 기반 통계(랭킹 신호). 매장·상품이 같은 유효 주문 정의(RANKING_VALID_ORDER_STATUSES·
 * 주문 생성 시각·삭제 주문 제외)를 공유하므로 키만 파라미터화한 1벌을 둔다(D35).
 */
@Injectable()
export class StoreStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 키별 최근 N일 유효 주문(아이템) 수. */
  async aggregateRecentOrderCounts(
    key: OrderStatsKey,
    ids: bigint[],
    since: Date,
  ): Promise<Map<bigint, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.orderItem.groupBy({
      by: [key],
      where: this.recentValidOrderItemWhere(key, ids, since),
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r[key], r._count._all]));
  }

  /**
   * 키별 최근 판매 수량 합(OrderItem.quantity). 인기 점수와 동일한 유효 주문 정의.
   * 실시간 판매 Best·판매순 정렬이 공유한다.
   */
  async aggregateSoldQuantities(
    key: OrderStatsKey,
    ids: bigint[],
    since: Date,
  ): Promise<Map<bigint, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.orderItem.groupBy({
      by: [key],
      where: this.recentValidOrderItemWhere(key, ids, since),
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r[key], r._sum.quantity ?? 0]));
  }

  private recentValidOrderItemWhere(
    key: OrderStatsKey,
    ids: bigint[],
    since: Date,
  ) {
    return {
      [key]: { in: ids },
      order: {
        status: { in: [...RANKING_VALID_ORDER_STATUSES] },
        created_at: { gte: since },
        // soft-delete extension은 nested relation filter에 deleted_at을 주입하지
        // 않으므로(=root read만 보정), 삭제된 주문이 랭킹을 부풀리지 않도록 명시한다.
        ...activeWhere,
      },
    };
  }
}
