import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import {
  kstMidnightUtc,
  kstMinutesOfDay,
  toKstYmd,
} from '@/common/utils/kst-time';
import { DEFAULT_POPULAR_STORES_LIMIT } from '@/features/store/constants/store-ranking.constants';
import type { TodayPickupStoresInput } from '@/features/store/dto/inputs/today-pickup-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import {
  StoreListingService,
  type ScoredStore,
} from '@/features/store/services/store-listing.service';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import {
  buildTodaySlots,
  timeColumnToMinutes,
} from '@/features/store/services/store-today-pickup.helper';
import type {
  TodayPickupSlot,
  TodayPickupStoreConnection,
} from '@/features/store/types/store-today-pickup-output.type';

const DAY_MS = 24 * 60 * 60 * 1000;

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
        this.repo.countPickupOrdersInRange(storeIds, dayStartUtc, dayEndUtc),
      ]);
    const hourByStore = new Map(
      businessHours.map((h) => [h.store_id.toString(), h]),
    );
    // 분 단위 절삭은 리드타임을 최대 59초 짧게 만들므로, 초가 남으면 다음 분으로 올린다
    const hasSubMinute =
      asOf.getUTCSeconds() > 0 || asOf.getUTCMilliseconds() > 0;
    const nowMinutes = kstMinutesOfDay(asOf) + (hasSubMinute ? 1 : 0);

    const open: { entry: ScoredStore; slots: TodayPickupSlot[] }[] = [];
    for (const entry of scored) {
      const storeId = entry.candidate.id;
      if (closedStoreIds.has(storeId.toString())) continue;

      const hour = hourByStore.get(storeId.toString());
      // 영업시간 미설정·휴무 요일이면 오늘 픽업 불가
      if (!hour || hour.is_closed || !hour.open_time || !hour.close_time) {
        continue;
      }

      // capacity 레코드가 없으면 무제한으로 간주(figma 명세 외 정책 결정)
      const capacity = capacities.get(storeId);
      const booked = bookedCounts.get(storeId) ?? 0;
      if (capacity !== undefined && booked >= capacity) continue;

      const slots = buildTodaySlots({
        openMinutes: timeColumnToMinutes(hour.open_time),
        closeMinutes: timeColumnToMinutes(hour.close_time),
        intervalMinutes: entry.candidate.pickup_slot_interval_minutes,
        leadTimeMinutes: entry.candidate.min_lead_time_minutes,
        nowMinutes,
      });
      if (!slots.some((slot) => slot.available)) continue;

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
      // 소수 첫째 자리까지(인기 매장 카드와 동일 표기)
      ratingAverage: Math.round(entry.metrics.ratingAverage * 10) / 10,
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
