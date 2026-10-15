import { Injectable } from '@nestjs/common';

import { kstDayBoundaries } from '@/common/utils/kst-time';
import { BookedQuantityPort } from '@/features/store/repositories/booked-quantity.port';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import {
  evaluatePickupDay,
  type PickupPolicyStore,
} from '@/features/store/services/store-pickup-policy.helper';
import type { TodayPickupSlot } from '@/features/store/types/store-today-pickup-output.type';

@Injectable()
export class StorePickupAvailabilityService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly booked: BookedQuantityPort,
  ) {}

  /**
   * 매장별 정책(요일 영업시간·특별휴무·슬롯 간격·리드타임·일일 capacity)으로 그날 예약 가능한 매장만 슬롯과 함께 돌려준다.
   * 판정은 달력·주문 재검증과 같은 evaluatePickupDay라 사유는 제외 여부로만 쓴다.
   */
  async openSlotsOn(
    stores: (PickupPolicyStore & { id: bigint })[],
    day: Date,
    now: Date,
  ): Promise<Map<bigint, TodayPickupSlot[]>> {
    const open = new Map<bigint, TodayPickupSlot[]>();
    if (stores.length === 0) return open;

    const storeIds = stores.map((s) => s.id);
    // seller가 저장한 closure/capacity 날짜는 UTC date 부분으로 기록되는 전제(dateOnlyUtc 비교)
    const { weekday, dateOnlyUtc, dayStartUtc, dayEndUtc } =
      kstDayBoundaries(day);
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

    for (const store of stores) {
      const { reason, slots } = evaluatePickupDay({
        store,
        hour: hourByStore.get(store.id.toString()),
        isSpecialClosure: closedStoreIds.has(store.id.toString()),
        capacity: capacities.get(store.id),
        booked: bookedCounts.get(store.id) ?? 0,
        now,
        dayStartUtc,
      });
      if (reason === null) open.set(store.id, slots);
    }
    return open;
  }
}
