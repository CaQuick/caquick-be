import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { kstDayBoundaries } from '@/common/utils/kst-time';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { DEFAULT_POPULAR_STORES_LIMIT } from '@/features/store/constants/store-ranking.constants';
import type { TodayPickupStoresInput } from '@/features/store/dto/inputs/today-pickup-stores.input';
import { BookedQuantityPort } from '@/features/store/repositories/booked-quantity.port';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import {
  StoreListingService,
  type ScoredStore,
} from '@/features/store/services/store-listing.service';
import { evaluatePickupDay } from '@/features/store/services/store-pickup-policy.helper';
import type {
  TodayPickupSlot,
  TodayPickupStoreConnection,
} from '@/features/store/types/store-today-pickup-output.type';

@Injectable()
export class StoreTodayPickupService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly booked: BookedQuantityPort,
    private readonly listingService: StoreListingService,
    private readonly cards: StoreCardService,
    private readonly clock: ClockService,
  ) {}

  /** 매장별 정책(요일 영업시간·특별휴무·슬롯 간격·리드타임·일일 capacity)을 모두 반영해 오늘 예약 가능 슬롯이 1개 이상인 매장만 노출한다. */
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
    // seller가 저장한 closure/capacity 날짜는 UTC date 부분으로 기록되는 전제(dateOnlyUtc 비교)
    const { weekday, dateOnlyUtc, dayStartUtc, dayEndUtc } =
      kstDayBoundaries(asOf);
    const [businessHours, closedStoreIds, capacities, bookedCounts] =
      await Promise.all([
        this.repo.findBusinessHoursByWeekday(storeIds, weekday),
        this.repo.findSpecialClosureStoreIds(storeIds, dateOnlyUtc),
        this.repo.findDailyCapacities(storeIds, dateOnlyUtc),
        this.booked.sumByStore(storeIds, dayStartUtc, dayEndUtc),
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
    const cards = await this.cards.buildCards(
      page.map(({ entry }) => entry.candidate),
      accountId,
      {
        stats: new Map(
          page.map(({ entry }) => [entry.candidate.id, entry.metrics]),
        ),
      },
    );
    const items = cards.map((store, idx) => ({
      store,
      slots: page[idx].slots,
    }));

    return {
      items,
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
      asOf,
    };
  }
}
