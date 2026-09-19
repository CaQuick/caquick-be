import { Injectable } from '@nestjs/common';

import { POPULAR_STORE_CAKE_IMAGE_LIMIT } from '@/features/store/constants/store-ranking.constants';
import { Prisma, type StoreMapProvider } from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export interface StoreCandidateRow {
  id: bigint;
  store_name: string;
  profile_image_url: string | null;
  address_city: string | null;
  address_neighborhood: string | null;
  region: { name: string } | null;
  pickup_slot_interval_minutes: number;
  min_lead_time_minutes: number;
  max_days_ahead: number;
}

export type StoreSearchCandidateRow = StoreCandidateRow;

export interface StoreSearchFilter {
  words: string[];
  regionIds?: bigint[];
}

export interface StoreTodayBusinessHourRow {
  store_id: bigint;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}

export interface StorePickupPolicyRow {
  id: bigint;
  pickup_slot_interval_minutes: number;
  min_lead_time_minutes: number;
  max_days_ahead: number;
}

export interface StoreWeekdayBusinessHourRow {
  day_of_week: number;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}

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
        profile_image_url: true,
        address_city: true,
        address_neighborhood: true,
        region: { select: { name: true } },
        pickup_slot_interval_minutes: true,
        min_lead_time_minutes: true,
        max_days_ahead: true,
      },
    });
  }

  /** 인기순 점수화가 메모리라 후보를 모두 로드한다(findActiveStoresForRanking과 동일 트레이드오프). */
  async findStoreSearchCandidates(
    filter: StoreSearchFilter,
  ): Promise<StoreSearchCandidateRow[]> {
    return this.prisma.store.findMany({
      where: buildStoreSearchWhere(filter),
      select: {
        id: true,
        store_name: true,
        address_city: true,
        address_neighborhood: true,
        region: { select: { name: true } },
        pickup_slot_interval_minutes: true,
        min_lead_time_minutes: true,
        max_days_ahead: true,
        profile_image_url: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /** 후보 조건과 단일 소스. */
  async countStoreSearch(filter: StoreSearchFilter): Promise<number> {
    return this.prisma.store.count({ where: buildStoreSearchWhere(filter) });
  }

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

  /** 레코드 없으면 무제한 취급은 호출부 책임. */
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

  /** 레코드 없으면 무제한 취급은 호출부 책임. */
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

  async existsActiveStore(storeId: bigint): Promise<boolean> {
    const found = await this.prisma.store.findFirst({
      where: { id: storeId, is_active: true },
      select: { id: true },
    });
    return Boolean(found);
  }

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

/** 단어별 매장명 contains AND + 활성 + 지역. */
export function buildStoreSearchWhere(
  filter: StoreSearchFilter,
): Prisma.StoreWhereInput {
  return {
    is_active: true,
    ...(filter.regionIds && filter.regionIds.length > 0
      ? { region_id: { in: filter.regionIds } }
      : {}),
    AND: filter.words.map((word) => ({ store_name: { contains: word } })),
  };
}
