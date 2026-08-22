import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import {
  kstDayDiff,
  kstMidnightUtc,
  kstMinutesOfDay,
  parseKstDate,
  parseKstYearMonth,
  toKstYmd,
} from '@/common/utils/kst-time';
import { PICKUP_AFTERNOON_START_MINUTES } from '@/features/pickup';
import { STORE_PICKUP_SCHEDULE_ERRORS } from '@/features/store/constants/store-pickup-schedule-error-messages';
import { STORE_PICKUP_DAY_REASON } from '@/features/store/constants/store-pickup-schedule.constants';
import {
  StoreRepository,
  type StorePickupPolicyRow,
  type StoreWeekdayBusinessHourRow,
} from '@/features/store/repositories/store.repository';
import {
  buildTodaySlots,
  timeColumnToMinutes,
} from '@/features/store/services/store-today-pickup.helper';
import type {
  StorePickupCalendar,
  StorePickupDay,
  StorePickupSlot,
  StorePickupTimeSlots,
} from '@/features/store/types/store-pickup-schedule-output.type';

/** 월/일 범위 벌크 조회 결과(달력 판정 컨텍스트). */
interface ScheduleContext {
  hoursByWeekday: Map<number, StoreWeekdayBusinessHourRow>;
  closureDates: Set<string>;
  capacities: Map<string, number>;
  bookedByDate: Map<string, number>;
}

@Injectable()
export class StorePickupScheduleService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly clock: ClockService,
  ) {}

  /**
   * 매장별 월 픽업 가능 날짜. todayPickupStores와 동일한 매장 정책
   * (요일 영업시간·특별휴무·일일 capacity·리드타임)을 월 단위로 판정한다.
   */
  async storePickupCalendar(
    storeId: bigint,
    yearMonth: string,
  ): Promise<StorePickupCalendar> {
    const ym = parseKstYearMonth(yearMonth);
    if (!ym) {
      throw new BadRequestException(
        STORE_PICKUP_SCHEDULE_ERRORS.INVALID_YEAR_MONTH,
      );
    }
    const store = await this.repo.findStoreForPickupSchedule(storeId);
    if (!store) {
      throw new NotFoundException(STORE_PICKUP_SCHEDULE_ERRORS.STORE_NOT_FOUND);
    }

    const now = this.clock.now();
    const daysInMonth = new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
    // 조회는 월 범위 벌크 4회로 끝내고, 날짜 루프에서는 추가 쿼리를 내지 않는다
    const ctx = await this.loadScheduleContext(
      store.id,
      new Date(Date.UTC(ym.year, ym.month - 1, 1)),
      new Date(Date.UTC(ym.year, ym.month, 1)),
      kstMidnightUtc(ym.year, ym.month, 1),
      kstMidnightUtc(ym.year, ym.month + 1, 1),
    );

    const days: StorePickupDay[] = Array.from(
      { length: daysInMonth },
      (_, index) => {
        const day = index + 1;
        const reason = this.evaluateDay(
          store,
          ctx,
          now,
          ym.year,
          ym.month,
          day,
        );
        return {
          date: new Date(Date.UTC(ym.year, ym.month - 1, day))
            .toISOString()
            .slice(0, 10),
          selectable: reason === null,
          reason,
        };
      },
    );

    return { yearMonth, days };
  }

  /**
   * 매장별 특정 날짜의 시간 슬롯(오전/오후). 영업하지 않는 날은 빈 배열,
   * 선택 불가 날짜(과거·범위 초과·휴무·capacity 소진)는 전 슬롯 마감 표기.
   */
  async storePickupTimeSlots(
    storeId: bigint,
    date: string,
  ): Promise<StorePickupTimeSlots> {
    const parsed = parseKstDate(date);
    if (!parsed) {
      throw new BadRequestException(STORE_PICKUP_SCHEDULE_ERRORS.INVALID_DATE);
    }
    const store = await this.repo.findStoreForPickupSchedule(storeId);
    if (!store) {
      throw new NotFoundException(STORE_PICKUP_SCHEDULE_ERRORS.STORE_NOT_FOUND);
    }

    const now = this.clock.now();
    const { year, month, day } = toKstYmd(parsed);
    const ctx = await this.loadScheduleContext(
      store.id,
      new Date(Date.UTC(year, month - 1, day)),
      new Date(Date.UTC(year, month - 1, day + 1)),
      parsed,
      kstMidnightUtc(year, month, day + 1),
    );

    const hour = ctx.hoursByWeekday.get(
      new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    );
    if (!hour || hour.is_closed || !hour.open_time || !hour.close_time) {
      return { date, morning: [], afternoon: [] };
    }

    const reason = this.evaluateDay(store, ctx, now, year, month, day);
    const isToday = kstDayDiff(now, parsed) === 0;
    let slots = this.buildDaySlots(
      store,
      hour.open_time,
      hour.close_time,
      isToday,
      now,
    );
    if (reason !== null) {
      slots = slots.map((slot) => ({ ...slot, available: false }));
    }

    return {
      date,
      morning: slots.filter(
        (slot) => slotMinutes(slot) < PICKUP_AFTERNOON_START_MINUTES,
      ),
      afternoon: slots.filter(
        (slot) => slotMinutes(slot) >= PICKUP_AFTERNOON_START_MINUTES,
      ),
    };
  }

  private async loadScheduleContext(
    storeId: bigint,
    fromDateOnly: Date,
    toDateOnly: Date,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<ScheduleContext> {
    const [hours, closureDates, capacities, bookedByDate] = await Promise.all([
      this.repo.findBusinessHoursForStore(storeId),
      this.repo.findSpecialClosureDatesInRange(
        storeId,
        fromDateOnly,
        toDateOnly,
      ),
      this.repo.findDailyCapacitiesInRange(storeId, fromDateOnly, toDateOnly),
      this.repo.sumPickupQuantitiesByKstDate(
        storeId,
        rangeStartUtc,
        rangeEndUtc,
      ),
    ]);
    return {
      hoursByWeekday: new Map(hours.map((h) => [h.day_of_week, h])),
      closureDates,
      capacities,
      bookedByDate,
    };
  }

  /**
   * 해당 KST 달력일의 선택 불가 사유(null이면 선택 가능).
   * 판정 순서: 과거 → 범위 초과 → 특별휴무 → 요일 휴무/영업시간 미설정
   * → capacity 소진 → 당일 잔여 가용 슬롯 없음.
   */
  private evaluateDay(
    store: StorePickupPolicyRow,
    ctx: ScheduleContext,
    now: Date,
    year: number,
    month: number,
    day: number,
  ): string | null {
    const dateOnlyUtc = new Date(Date.UTC(year, month - 1, day));
    const dateKey = dateOnlyUtc.toISOString().slice(0, 10);
    const diff = kstDayDiff(now, kstMidnightUtc(year, month, day));

    if (diff < 0) return STORE_PICKUP_DAY_REASON.PAST;
    if (diff > store.max_days_ahead) {
      return STORE_PICKUP_DAY_REASON.OUT_OF_RANGE;
    }
    if (ctx.closureDates.has(dateKey)) return STORE_PICKUP_DAY_REASON.CLOSED;

    const hour = ctx.hoursByWeekday.get(dateOnlyUtc.getUTCDay());
    if (!hour || hour.is_closed || !hour.open_time || !hour.close_time) {
      return STORE_PICKUP_DAY_REASON.CLOSED;
    }

    // capacity 레코드가 없으면 무제한으로 간주(todayPickupStores와 동일 해석)
    const capacity = ctx.capacities.get(dateKey);
    const booked = ctx.bookedByDate.get(dateKey) ?? 0;
    if (capacity !== undefined && booked >= capacity) {
      return STORE_PICKUP_DAY_REASON.CAPACITY_FULL;
    }

    // 당일은 리드타임 반영 잔여 슬롯이 있어야 선택 가능(전역 pickupCalendar 선례와 일치)
    if (diff === 0) {
      const slots = this.buildDaySlots(
        store,
        hour.open_time,
        hour.close_time,
        true,
        now,
      );
      if (!slots.some((slot) => slot.available)) {
        return STORE_PICKUP_DAY_REASON.CLOSED;
      }
    }
    return null;
  }

  /** 영업시간·매장 슬롯 간격으로 슬롯 생성. 당일만 리드타임 컷오프를 적용한다. */
  private buildDaySlots(
    store: StorePickupPolicyRow,
    openTime: Date,
    closeTime: Date,
    isToday: boolean,
    now: Date,
  ): StorePickupSlot[] {
    // 분 단위 절삭은 리드타임을 최대 59초 짧게 만들므로, 초가 남으면 다음 분으로 올린다
    const hasSubMinute =
      now.getUTCSeconds() > 0 || now.getUTCMilliseconds() > 0;
    // 미래일은 컷오프 무력화(-Infinity + 리드타임 = -Infinity → 전 슬롯 가용)
    const nowMinutes = isToday
      ? kstMinutesOfDay(now) + (hasSubMinute ? 1 : 0)
      : Number.NEGATIVE_INFINITY;
    return buildTodaySlots({
      openMinutes: timeColumnToMinutes(openTime),
      closeMinutes: timeColumnToMinutes(closeTime),
      intervalMinutes: store.pickup_slot_interval_minutes,
      leadTimeMinutes: store.min_lead_time_minutes,
      nowMinutes,
    });
  }
}

/** "HH:MM" 슬롯 시각을 자정 경과 분으로 변환(오전/오후 분리용). */
function slotMinutes(slot: StorePickupSlot): number {
  const hours = Number(slot.time.slice(0, 2));
  const minutes = Number(slot.time.slice(3, 5));
  return hours * 60 + minutes;
}
