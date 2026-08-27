import { Injectable } from '@nestjs/common';
import { Prisma, type StoreMapProvider } from '@prisma/client';

import {
  POPULAR_STORE_CAKE_IMAGE_LIMIT,
  RANKING_VALID_ORDER_STATUSES,
} from '@/features/store/constants/store-ranking.constants';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export interface StoreCandidateRow {
  id: bigint;
  store_name: string;
  address_city: string | null;
  address_neighborhood: string | null;
  region: { name: string } | null;
  pickup_slot_interval_minutes: number;
  min_lead_time_minutes: number;
  max_days_ahead: number;
}

/** 특정 요일의 매장 영업시간 row(오늘 픽업 슬롯 산출용). */
export interface StoreTodayBusinessHourRow {
  store_id: bigint;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}

/** 매장 픽업 정책 row(달력·시간 슬롯 산출용). */
export interface StorePickupPolicyRow {
  id: bigint;
  pickup_slot_interval_minutes: number;
  min_lead_time_minutes: number;
  max_days_ahead: number;
}

/** 요일별 영업시간 row(매장 픽업 달력용). */
export interface StoreWeekdayBusinessHourRow {
  day_of_week: number;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
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
        pickup_slot_interval_minutes: true,
        min_lead_time_minutes: true,
        max_days_ahead: true,
      },
    });
  }

  /** 특정 요일(0=일~6=토)의 매장별 영업시간. */
  async findBusinessHoursByWeekday(
    storeIds: bigint[],
    dayOfWeek: number,
  ): Promise<StoreTodayBusinessHourRow[]> {
    if (storeIds.length === 0) return [];
    return this.prisma.storeBusinessHour.findMany({
      where: {
        store_id: { in: storeIds },
        day_of_week: dayOfWeek,
      },
      select: {
        store_id: true,
        is_closed: true,
        open_time: true,
        close_time: true,
      },
    });
  }

  /** 특정 날짜(@db.Date, UTC 자정 표현)에 특별휴무인 매장 id 집합. */
  async findSpecialClosureStoreIds(
    storeIds: bigint[],
    date: Date,
  ): Promise<Set<string>> {
    if (storeIds.length === 0) return new Set();
    const rows = await this.prisma.storeSpecialClosure.findMany({
      where: {
        store_id: { in: storeIds },
        closure_date: date,
      },
      select: { store_id: true },
    });
    return new Set(rows.map((r) => r.store_id.toString()));
  }

  /** 특정 날짜의 매장별 일일 capacity(레코드 없으면 무제한 취급은 호출부 책임). */
  async findDailyCapacities(
    storeIds: bigint[],
    date: Date,
  ): Promise<Map<bigint, number>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.storeDailyCapacity.findMany({
      where: {
        store_id: { in: storeIds },
        capacity_date: date,
      },
      select: { store_id: true, capacity: true },
    });
    return new Map(rows.map((r) => [r.store_id, r.capacity]));
  }

  /**
   * 픽업 시각이 [rangeStart, rangeEnd)인 매장별 예약 제작 수량(아이템 quantity 합).
   * capacity(일별 생산 가능 '수량') 소진 판정용 — CANCELED·soft-delete 주문은 제외한다.
   */
  async sumPickupQuantitiesInRange(
    storeIds: bigint[],
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<Map<bigint, number>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { store_id: bigint; booked_quantity: bigint }[]
    >(Prisma.sql`
      SELECT oi.store_id AS store_id,
             CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS booked_quantity
      FROM order_item oi
      JOIN \`order\` o
        ON o.id = oi.order_id
        AND o.deleted_at IS NULL
        AND o.status <> 'CANCELED'
        AND o.pickup_at >= ${rangeStart}
        AND o.pickup_at < ${rangeEnd}
      WHERE oi.store_id IN (${Prisma.join(storeIds)})
        AND oi.deleted_at IS NULL
      GROUP BY oi.store_id
    `);
    return new Map(rows.map((r) => [r.store_id, Number(r.booked_quantity)]));
  }

  /** 픽업 달력·슬롯 산출용 매장 정책. 활성·미삭제 매장만. */
  async findStoreForPickupSchedule(
    storeId: bigint,
  ): Promise<StorePickupPolicyRow | null> {
    return this.prisma.store.findFirst({
      where: { id: storeId, is_active: true },
      select: {
        id: true,
        pickup_slot_interval_minutes: true,
        min_lead_time_minutes: true,
        max_days_ahead: true,
      },
    });
  }

  /** 매장의 요일별 영업시간 전체(요일당 최대 1행). */
  async findBusinessHoursForStore(
    storeId: bigint,
  ): Promise<StoreWeekdayBusinessHourRow[]> {
    return this.prisma.storeBusinessHour.findMany({
      where: { store_id: storeId },
      select: {
        day_of_week: true,
        is_closed: true,
        open_time: true,
        close_time: true,
      },
    });
  }

  /** [from, to) 범위(@db.Date, UTC 자정 표현)의 특별휴무 날짜 집합("YYYY-MM-DD"). */
  async findSpecialClosureDatesInRange(
    storeId: bigint,
    from: Date,
    to: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.storeSpecialClosure.findMany({
      where: {
        store_id: storeId,
        closure_date: { gte: from, lt: to },
      },
      select: { closure_date: true },
    });
    return new Set(rows.map((r) => r.closure_date.toISOString().slice(0, 10)));
  }

  /** [from, to) 범위의 일일 capacity 맵("YYYY-MM-DD" → capacity). 레코드 없으면 무제한 취급은 호출부 책임. */
  async findDailyCapacitiesInRange(
    storeId: bigint,
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.storeDailyCapacity.findMany({
      where: {
        store_id: storeId,
        capacity_date: { gte: from, lt: to },
      },
      select: { capacity_date: true, capacity: true },
    });
    return new Map(
      rows.map((r) => [r.capacity_date.toISOString().slice(0, 10), r.capacity]),
    );
  }

  /**
   * 픽업 시각이 [rangeStart, rangeEnd)인 KST 날짜별 예약 제작 수량(아이템 quantity 합).
   * capacity 소진 판정용 — CANCELED·soft-delete 주문은 제외한다.
   * KST는 DST 없는 고정 +9h라 INTERVAL 9 HOUR 변환으로 달력일을 묶는다.
   */
  async sumPickupQuantitiesByKstDate(
    storeId: bigint,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      { pickup_date: string; booked_quantity: bigint }[]
    >(Prisma.sql`
      SELECT DATE_FORMAT(DATE_ADD(o.pickup_at, INTERVAL 9 HOUR), '%Y-%m-%d') AS pickup_date,
             CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS booked_quantity
      FROM order_item oi
      JOIN \`order\` o
        ON o.id = oi.order_id
        AND o.deleted_at IS NULL
        AND o.status <> 'CANCELED'
        AND o.pickup_at >= ${rangeStart}
        AND o.pickup_at < ${rangeEnd}
      WHERE oi.store_id = ${storeId}
        AND oi.deleted_at IS NULL
      GROUP BY pickup_date
    `);
    return new Map(rows.map((r) => [r.pickup_date, Number(r.booked_quantity)]));
  }

  /** 활성 매장 존재 검증(찜 등). */
  async existsActiveStore(storeId: bigint): Promise<boolean> {
    const found = await this.prisma.store.findFirst({
      where: { id: storeId, is_active: true },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** 매장 상세 헤더 조회. 활성·미삭제 매장만. 대표 이미지는 sort_order asc. */
  async findStoreDetailById(storeId: bigint): Promise<StoreDetailRow | null> {
    return this.prisma.store.findFirst({
      where: { id: storeId, is_active: true },
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
          where: activeWhere,
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
      where: { store_id: { in: storeIds } },
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
      where: { store_id: { in: storeIds } },
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
        order: {
          status: { in: [...RANKING_VALID_ORDER_STATUSES] },
          created_at: { gte: since },
          // soft-delete extension은 nested relation filter에 deleted_at을 주입하지
          // 않으므로(=root read만 보정), 삭제된 주문이 랭킹을 부풀리지 않도록 명시한다.
          ...activeWhere,
        },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.store_id, r._count._all]));
  }

  /** 전체 활성 리뷰 평균 평점(베이지안 prior). 리뷰가 없으면 null. */
  async globalReviewAverage(): Promise<number | null> {
    const agg = await this.prisma.review.aggregate({
      _avg: { rating: true },
    });
    return agg._avg.rating !== null ? Number(agg._avg.rating) : null;
  }

  /** 페이지 매장들의 대표 케이크 이미지(매장당 최대 N장, 활성 상품 1장씩). */
  async findStoreCakeImages(
    storeIds: bigint[],
    limit: number = POPULAR_STORE_CAKE_IMAGE_LIMIT,
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
            ...visibleWhere,
            images: { some: activeWhere },
          },
          orderBy: { id: 'desc' },
          take: limit,
          select: {
            images: {
              where: activeWhere,
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
