import { Injectable } from '@nestjs/common';

import {
  POPULAR_STORE_CAKE_IMAGE_LIMIT,
  RANKING_VALID_ORDER_STATUSES,
} from '@/features/store/constants/store-ranking.constants';
import { PrismaService } from '@/prisma';

export interface StoreCandidateRow {
  id: bigint;
  store_name: string;
  address_city: string | null;
  address_neighborhood: string | null;
  region: { name: string } | null;
}

export interface StoreReviewStat {
  average: number;
  count: number;
}

@Injectable()
export class StoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 인기 매장 랭킹 후보. 활성 매장만, 지역 필터(2차 시군구 다중) 적용. */
  async findActiveStoresForRanking(
    regionIds?: bigint[],
  ): Promise<StoreCandidateRow[]> {
    return this.prisma.store.findMany({
      where: {
        is_active: true,
        deleted_at: null,
        ...(regionIds && regionIds.length > 0
          ? { region_id: { in: regionIds } }
          : {}),
      },
      select: {
        id: true,
        store_name: true,
        address_city: true,
        address_neighborhood: true,
        region: { select: { name: true } },
      },
    });
  }

  /** 매장별 활성 찜 수. */
  async aggregateWishlistCounts(
    storeIds: bigint[],
  ): Promise<Map<bigint, number>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.storeWishlistItem.groupBy({
      by: ['store_id'],
      where: { store_id: { in: storeIds }, deleted_at: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.store_id, r._count._all]));
  }

  /** 매장별 평균 평점·리뷰 수. */
  async aggregateReviewStats(
    storeIds: bigint[],
  ): Promise<Map<bigint, StoreReviewStat>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.review.groupBy({
      by: ['store_id'],
      where: { store_id: { in: storeIds }, deleted_at: null },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return new Map(
      rows.map((r) => [
        r.store_id,
        {
          average: r._avg.rating !== null ? Number(r._avg.rating) : 0,
          count: r._count._all,
        },
      ]),
    );
  }

  /** 매장별 최근 N일 유효 주문(아이템) 수. */
  async aggregateRecentOrderCounts(
    storeIds: bigint[],
    since: Date,
  ): Promise<Map<bigint, number>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.orderItem.groupBy({
      by: ['store_id'],
      where: {
        store_id: { in: storeIds },
        deleted_at: null,
        order: {
          status: { in: [...RANKING_VALID_ORDER_STATUSES] },
          created_at: { gte: since },
        },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.store_id, r._count._all]));
  }

  /** 전체 활성 리뷰 평균 평점(베이지안 prior). 리뷰가 없으면 null. */
  async globalReviewAverage(): Promise<number | null> {
    const agg = await this.prisma.review.aggregate({
      where: { deleted_at: null },
      _avg: { rating: true },
    });
    return agg._avg.rating !== null ? Number(agg._avg.rating) : null;
  }

  /** 페이지 매장들의 대표 케이크 이미지(매장당 최대 N장, 활성 상품 1장씩). */
  async findStoreCakeImages(
    storeIds: bigint[],
  ): Promise<Map<bigint, string[]>> {
    if (storeIds.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { store_id: { in: storeIds }, is_active: true, deleted_at: null },
      orderBy: [{ store_id: 'asc' }, { id: 'desc' }],
      select: {
        store_id: true,
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          take: 1,
          select: { image_url: true },
        },
      },
    });

    const map = new Map<bigint, string[]>();
    for (const product of products) {
      const url = product.images[0]?.image_url;
      if (!url) continue;
      const acc = map.get(product.store_id) ?? [];
      if (acc.length < POPULAR_STORE_CAKE_IMAGE_LIMIT) {
        acc.push(url);
        map.set(product.store_id, acc);
      }
    }
    return map;
  }
}
