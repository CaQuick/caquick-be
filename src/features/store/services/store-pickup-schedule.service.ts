import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import {
  kstMidnightUtc,
  kstMinutesOfDay,
  parseKstDate,
  parseKstYearMonth,
  toKstYmd,
} from '@/common/utils/kst-time';
import { PICKUP_AFTERNOON_START_MINUTES } from '@/features/pickup';
import { STORE_PICKUP_SCHEDULE_ERRORS } from '@/features/store/constants/store-pickup-schedule-error-messages';
import {
  StoreRepository,
  type StorePickupPolicyRow,
  type StoreWeekdayBusinessHourRow,
} from '@/features/store/repositories/store.repository';
import {
  evaluatePickupDay,
  type PickupDayInput,
} from '@/features/store/services/store-pickup-policy.helper';
import type {
  StorePickupCalendar,
  StorePickupDay,
  StorePickupSlot,
  StorePickupTimeSlots,
} from '@/features/store/types/store-pickup-schedule-output.type';

// MySQL DATE/DATETIME 표현 범위(1000-01-01~9999-12-31) 안에서 KST 자정(-9h) 경계와
// 익월/익일 상한 계산이 넘치지 않도록 연도를 제한한다.
// 하한 1001: 1000-01의 KST 월 시작 경계가 0999-12-31T15:00Z로 DATETIME 하한을 밑돈다.
// 상한 9998: 9999-12의 익월 상한이 DATE 상한을 넘는다.
// Date.UTC의 0~99년 → 1900년대 매핑 오동작도 함께 차단.
const MIN_SCHEDULE_YEAR = 1001;
const MAX_SCHEDULE_YEAR = 9998;

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
    if (!ym || ym.year < MIN_SCHEDULE_YEAR || ym.year > MAX_SCHEDULE_YEAR) {
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
        const { reason } = evaluatePickupDay(
          this.pickupDayInput(store, ctx, now, ym.year, ym.month, day),
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
    const { year, month, day } = toKstYmd(parsed);
    if (year < MIN_SCHEDULE_YEAR || year > MAX_SCHEDULE_YEAR) {
      throw new BadRequestException(STORE_PICKUP_SCHEDULE_ERRORS.INVALID_DATE);
    }
    const store = await this.repo.findStoreForPickupSchedule(storeId);
    if (!store) {
      throw new NotFoundException(STORE_PICKUP_SCHEDULE_ERRORS.STORE_NOT_FOUND);
    }

    const now = this.clock.now();
    const ctx = await this.loadScheduleContext(
      store.id,
      new Date(Date.UTC(year, month - 1, day)),
      new Date(Date.UTC(year, month - 1, day + 1)),
      parsed,
      kstMidnightUtc(year, month, day + 1),
    );

    const input = this.pickupDayInput(store, ctx, now, year, month, day);
    const result = evaluatePickupDay(input);
    // 특별휴무도 요일 휴무·영업시간 미설정과 같은 "영업하지 않는 날" — SDL 주석대로
    // 빈 배열로 통일한다(슬롯이 비면 요일 휴무·미설정, 영업일 무슬롯도 동일 표현).
    // (PAST/OUT_OF_RANGE/CAPACITY_FULL/당일 마감은 영업일이므로 슬롯을 마감 표기로 유지)
    if (input.isSpecialClosure || result.slots.length === 0) {
      return { date, morning: [], afternoon: [] };
    }

    const slots =
      result.reason !== null
        ? result.slots.map((slot) => ({ ...slot, available: false }))
        : result.slots;

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

  /**
   * 특정 픽업 일시가 예약 가능한지 판정한다(주문 생성 재검증용).
   * 달력·시간 슬롯과 동일 규칙에 더해 슬롯 시작 시각 정합과
   * capacity 잔여(기존 점유 + additionalQuantity ≤ capacity)를 확인한다.
   * 매장이 없거나 비활성이면 false(존재 검증은 호출부 책임).
   */
  async isPickupSlotAvailable(args: {
    storeId: bigint;
    pickupAt: Date;
    additionalQuantity?: number;
  }): Promise<boolean> {
    const store = await this.repo.findStoreForPickupSchedule(args.storeId);
    if (!store) return false;

    // 슬롯은 분 단위 시작 시각 포인트 — 초 이하가 남아 있으면 슬롯 정합 실패
    if (
      args.pickupAt.getUTCSeconds() !== 0 ||
      args.pickupAt.getUTCMilliseconds() !== 0
    ) {
      return false;
    }

    const now = this.clock.now();
    const { year, month, day } = toKstYmd(args.pickupAt);
    if (year < MIN_SCHEDULE_YEAR || year > MAX_SCHEDULE_YEAR) return false;

    const dateOnlyUtc = new Date(Date.UTC(year, month - 1, day));
    const ctx = await this.loadScheduleContext(
      store.id,
      dateOnlyUtc,
      new Date(Date.UTC(year, month - 1, day + 1)),
      kstMidnightUtc(year, month, day),
      kstMidnightUtc(year, month, day + 1),
    );

    const input = this.pickupDayInput(store, ctx, now, year, month, day);
    const result = evaluatePickupDay(input);
    if (result.reason !== null) return false;

    // capacity 잔여: 이번 주문 수량까지 더해 초과하면 불가 — 공용 판정(소진 여부)에
    // 얹는 주문 생성 전용 확장 검사.
    // (명세 외 정책 결정: capacity는 일일 제작 '수량' 소진 모델과 일관되게 해석)
    const quantity = args.additionalQuantity ?? 1;
    if (
      input.capacity !== undefined &&
      input.booked + quantity > input.capacity
    ) {
      return false;
    }

    const pickupMinutes = kstMinutesOfDay(args.pickupAt);
    return result.slots.some(
      (slot) => slot.available && slotMinutes(slot) === pickupMinutes,
    );
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
   * 월/일 벌크 조회 컨텍스트를 해당 KST 달력일의 정책 입력으로 변환한다.
   * 판정 자체는 공용 정책(store-pickup-policy.helper)이 담당한다.
   */
  private pickupDayInput(
    store: StorePickupPolicyRow,
    ctx: ScheduleContext,
    now: Date,
    year: number,
    month: number,
    day: number,
  ): PickupDayInput {
    const dateOnlyUtc = new Date(Date.UTC(year, month - 1, day));
    const dateKey = dateOnlyUtc.toISOString().slice(0, 10);
    return {
      store,
      hour: ctx.hoursByWeekday.get(dateOnlyUtc.getUTCDay()),
      isSpecialClosure: ctx.closureDates.has(dateKey),
      capacity: ctx.capacities.get(dateKey),
      booked: ctx.bookedByDate.get(dateKey) ?? 0,
      now,
      dayStartUtc: kstMidnightUtc(year, month, day),
    };
  }
}

/** "HH:MM" 슬롯 시각을 자정 경과 분으로 변환(오전/오후 분리용). */
function slotMinutes(slot: StorePickupSlot): number {
  const hours = Number(slot.time.slice(0, 2));
  const minutes = Number(slot.time.slice(3, 5));
  return hours * 60 + minutes;
}
