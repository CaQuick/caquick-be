import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { DAY_MS, kstMidnightUtc, toKstYmd } from '@/common/utils/kst-time';
import { roundRatingAverage } from '@/common/utils/rating';
import { DEFAULT_POPULAR_STORES_LIMIT } from '@/features/store/constants/store-ranking.constants';
import type { TodayPickupStoresInput } from '@/features/store/dto/inputs/today-pickup-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import {
  StoreListingService,
  type ScoredStore,
} from '@/features/store/services/store-listing.service';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import { evaluatePickupDay } from '@/features/store/services/store-pickup-policy.helper';
import type {
  TodayPickupSlot,
  TodayPickupStoreConnection,
} from '@/features/store/types/store-today-pickup-output.type';

@Injectable()
export class StoreTodayPickupService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly listingService: StoreListingService,
    private readonly clock: ClockService,
  ) {}

  /**
   * 오늘(KST) 픽업 가능 매장 리스트. 인기 매장과 동일 랭킹으로 정렬하되,
   * 매장별 정책(요일 영업시간·특별휴무·슬롯 간격·리드타임·일일 capacity)을
   * 모두 반영해 오늘 예약 가능 슬롯이 1개 이상인 매장만 노출한다.
   */
  async todayPickupStores(
    input?: TodayPickupStoresInput,
    accountId?: bigint,
  ): Promise<TodayPickupStoreConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_POPULAR_STORES_LIMIT;
    const regionIds = input?.regionIds?.map((id) => parseId(id));

    const asOf = this.clock.now();
    const scored = await this.listingService.rankActiveStores(regionIds, asOf);
    if (scored.length === 0) {
      return { items: [], totalCount: 0, hasMore: false, asOf };
    }

    const storeIds = scored.map((s) => s.candidate.id);
    const { weekday, dateOnlyUtc, dayStartUtc, dayEndUtc } = todayKst(asOf);
    const [businessHours, closedStoreIds, capacities, bookedCounts] =
      await Promise.all([
        this.repo.findBusinessHoursByWeekday(storeIds, weekday),
        this.repo.findSpecialClosureStoreIds(storeIds, dateOnlyUtc),
        this.repo.findDailyCapacities(storeIds, dateOnlyUtc),
        this.repo.sumPickupQuantitiesInRange(storeIds, dayStartUtc, dayEndUtc),
      ]);
    const hourByStore = new Map(
      businessHours.map((h) => [h.store_id.toString(), h]),
    );

    const open: { entry: ScoredStore; slots: TodayPickupSlot[] }[] = [];
    for (const entry of scored) {
      const storeId = entry.candidate.id;
      // 판정은 공용 정책(store-pickup-policy.helper) 단일 소스 — 달력·주문 재검증과
      // 동일 규칙. '오늘'은 PAST/OUT_OF_RANGE가 항상 통과라 사유는 제외 여부로만 쓴다.
      const { reason, slots } = evaluatePickupDay({
        store: entry.candidate,
        hour: hourByStore.get(storeId.toString()),
        isSpecialClosure: closedStoreIds.has(storeId.toString()),
        capacity: capacities.get(storeId),
        booked: bookedCounts.get(storeId) ?? 0,
        now: asOf,
        dayStartUtc,
      });
      if (reason !== null) continue;

      open.push({ entry, slots });
    }

    const totalCount = open.length;
    const page = open.slice(offset, offset + limit);
    const pageStoreIds = page.map((p) => p.entry.candidate.id);
    const [imagesByStore, wishlistedIds] = await Promise.all([
      this.repo.findStoreCakeImages(pageStoreIds),
      // 0n도 유효한 계정 id — truthy 체크는 0n을 비로그인으로 떨궈 undefined로만 분기한다
      accountId !== undefined
        ? this.wishlistRepo.findWishlistedStoreIds({
            accountId,
            storeIds: pageStoreIds,
          })
        : Promise.resolve(new Set<string>()),
    ]);

    const items = page.map(({ entry, slots }) => ({
      id: entry.candidate.id.toString(),
      storeName: entry.candidate.store_name,
      ratingAverage: roundRatingAverage(entry.metrics.ratingAverage),
      reviewCount: entry.metrics.reviewCount,
      regionLabel: buildRegionLabel(entry.candidate),
      cakeImageUrls: imagesByStore.get(entry.candidate.id) ?? [],
      isWishlisted: wishlistedIds.has(entry.candidate.id.toString()),
      slots,
    }));

    return {
      items,
      totalCount,
      hasMore: offset + limit < totalCount,
      asOf,
    };
  }
}

/**
 * asOf 기준 KST '오늘'의 요일과 날짜 경계.
 * - dateOnlyUtc: @db.Date 컬럼 비교용(해당 KST 달력일의 UTC 자정 표현).
 *   seller가 저장한 closure/capacity 날짜도 UTC date 부분으로 기록되는 전제.
 * - dayStartUtc/dayEndUtc: pickup_at(DateTime) 범위 비교용(KST 자정 경계).
 */
function todayKst(asOf: Date): {
  weekday: number;
  dateOnlyUtc: Date;
  dayStartUtc: Date;
  dayEndUtc: Date;
} {
  const { year, month, day } = toKstYmd(asOf);
  const dateOnlyUtc = new Date(Date.UTC(year, month - 1, day));
  const dayStartUtc = kstMidnightUtc(year, month, day);
  const dayEndUtc = new Date(dayStartUtc.getTime() + DAY_MS);
  return {
    weekday: dateOnlyUtc.getUTCDay(),
    dateOnlyUtc,
    dayStartUtc,
    dayEndUtc,
  };
}
