import { Injectable } from '@nestjs/common';
import { Prisma, type StoreMapProvider } from '@prisma/client';

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

/** 매장 상세 조회 결과 row. storeDetail 매퍼 입력. */
export interface StoreDetailRow {
  id: bigint;
  store_name: string;
  store_phone: string;
  address_full: string;
  address_city: string | null;
  address_neighborhood: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  map_provider: StoreMapProvider;
  business_hours_text: string | null;
  access_guide_text: string | null;
  regular_closure_text: string | null;
  website_url: string | null;
  region: { name: string } | null;
  store_images: { image_url: string }[];
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

  /** 활성 매장 존재 검증(찜 등). */
  async existsActiveStore(storeId: bigint): Promise<boolean> {
    const found = await this.prisma.store.findFirst({
      where: { id: storeId, is_active: true, deleted_at: null },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** 매장 상세 헤더 조회. 활성·미삭제 매장만. 대표 이미지는 sort_order asc. */
  async findStoreDetailById(storeId: bigint): Promise<StoreDetailRow | null> {
    return this.prisma.store.findFirst({
      where: { id: storeId, is_active: true, deleted_at: null },
      select: {
        id: true,
        store_name: true,
        store_phone: true,
        address_full: true,
        address_city: true,
        address_neighborhood: true,
        latitude: true,
        longitude: true,
        map_provider: true,
        business_hours_text: true,
        access_guide_text: true,
        regular_closure_text: true,
        website_url: true,
        region: { select: { name: true } },
        store_images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          select: { image_url: true },
        },
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
          // soft-delete extension은 nested relation filter에 deleted_at을 주입하지
          // 않으므로(=root read만 보정), 삭제된 주문이 랭킹을 부풀리지 않도록 명시한다.
          deleted_at: null,
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

    // 매장당 이미지 보유 활성 상품을 최대 N개만 조회한다. 전체 상품을 materialize한
    // 뒤 JS에서 자르면 상품이 많은 매장에서 불필요한 row 스캔이 발생하므로,
    // 쿼리 단계에서 take로 제한한다(페이지 크기만큼의 병렬 조회).
    const entries = await Promise.all(
      storeIds.map(async (storeId) => {
        const products = await this.prisma.product.findMany({
          where: {
            store_id: storeId,
            is_active: true,
            deleted_at: null,
            images: { some: { deleted_at: null } },
          },
          orderBy: { id: 'desc' },
          take: POPULAR_STORE_CAKE_IMAGE_LIMIT,
          select: {
            images: {
              where: { deleted_at: null },
              orderBy: { sort_order: 'asc' },
              take: 1,
              select: { image_url: true },
            },
          },
        });
        const urls = products
          .map((product) => product.images[0]?.image_url)
          .filter((url): url is string => Boolean(url));
        return [storeId, urls] as const;
      }),
    );

    return new Map(entries);
  }
}
