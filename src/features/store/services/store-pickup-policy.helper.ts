import { kstDayDiff } from '@/common/utils/kst-time';
import { STORE_PICKUP_DAY_REASON } from '@/features/store/constants/store-pickup-schedule.constants';
import {
  buildTodaySlots,
  timeColumnToMinutes,
} from '@/features/store/services/store-today-pickup.helper';
import type { TodayPickupSlot } from '@/features/store/types/store-today-pickup-output.type';

/**
 * 매장 픽업 가능 판정 정책(단일 소스, 이슈 #206).
 * today-pickup 리스트·픽업 달력/시간 슬롯·주문 생성 재검증이 모두 이 모듈을
 * 소비한다 — 판정 분기를 한쪽만 고치는 규칙 불일치를 구조적으로 차단한다.
 * DI-free 순수 함수만 둔다(시각은 호출부가 ClockService로 주입).
 */

/** 판정에 필요한 매장 픽업 정책 필드(store row 부분집합). */
export interface PickupPolicyStore {
  pickup_slot_interval_minutes: number;
  min_lead_time_minutes: number;
  max_days_ahead: number;
}

/** 해당 요일의 영업시간 row 부분집합. */
export interface PickupBusinessHour {
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}

export type StorePickupDayReason =
  (typeof STORE_PICKUP_DAY_REASON)[keyof typeof STORE_PICKUP_DAY_REASON];

export interface PickupDayInput {
  store: PickupPolicyStore;
  /** 해당 날짜 요일의 영업시간(미설정이면 undefined). */
  hour: PickupBusinessHour | undefined;
  isSpecialClosure: boolean;
  /** 일일 제작 capacity. 레코드가 없으면 undefined = 무제한. */
  capacity: number | undefined;
  /** 해당 날짜에 이미 점유된 수량 합(취소·soft-delete 제외). */
  booked: number;
  now: Date;
  /** 해당 KST 달력일 자정(UTC 시각). */
  dayStartUtc: Date;
}

export interface PickupDayResult {
  /** 선택 불가 사유. null이면 선택 가능. */
  reason: StorePickupDayReason | null;
  /**
   * 영업시간·간격·리드타임 반영 슬롯. 영업하지 않는 날(요일 휴무·미설정)은
   * 빈 배열. reason이 있어도 영업일이면 슬롯을 반환한다(마감 표기용).
   */
  slots: TodayPickupSlot[];
}

/**
 * 해당 KST 달력일의 픽업 가능 여부 판정.
 * 판정 순서: 과거 → 범위 초과 → 특별휴무 → 요일 휴무/영업시간 미설정
 * → capacity 소진 → 리드타임 반영 잔여 가용 슬롯 없음.
 */
export function evaluatePickupDay(input: PickupDayInput): PickupDayResult {
  const { store, hour, now, dayStartUtc } = input;
  const activeHour =
    hour && !hour.is_closed && hour.open_time && hour.close_time
      ? { openTime: hour.open_time, closeTime: hour.close_time }
      : undefined;
  const slots = activeHour
    ? buildPickupDaySlots(
        store,
        activeHour.openTime,
        activeHour.closeTime,
        dayStartUtc,
        now,
      )
    : [];

  const diff = kstDayDiff(now, dayStartUtc);
  if (diff < 0) return { reason: STORE_PICKUP_DAY_REASON.PAST, slots };
  if (diff > store.max_days_ahead) {
    return { reason: STORE_PICKUP_DAY_REASON.OUT_OF_RANGE, slots };
  }
  if (input.isSpecialClosure) {
    return { reason: STORE_PICKUP_DAY_REASON.CLOSED, slots };
  }
  if (!activeHour) {
    return { reason: STORE_PICKUP_DAY_REASON.CLOSED, slots };
  }

  // capacity 레코드가 없으면 무제한으로 간주(figma 명세 외 정책 결정)
  if (input.capacity !== undefined && input.booked >= input.capacity) {
    return { reason: STORE_PICKUP_DAY_REASON.CAPACITY_FULL, slots };
  }

  // 리드타임 반영 잔여 슬롯이 없는 날은 선택 불가(전역 pickupCalendar 선례 확장).
  // 리드타임이 하루를 넘으면 미래 날짜도 여기서 마감된다.
  if (!slots.some((slot) => slot.available)) {
    return { reason: STORE_PICKUP_DAY_REASON.CLOSED, slots };
  }
  return { reason: null, slots };
}

/**
 * 영업시간·매장 슬롯 간격으로 슬롯 생성. 리드타임 컷오프는 절대 시각
 * (now + 리드타임) 기준이라 하루를 넘는 리드타임(최대 7일)도 미래 날짜에
 * 올바르게 적용된다 — 당일만 컷오프하던 방식의 릴리즈 리뷰 반영.
 */
export function buildPickupDaySlots(
  store: PickupPolicyStore,
  openTime: Date,
  closeTime: Date,
  dayStartUtc: Date,
  now: Date,
): TodayPickupSlot[] {
  // 해당 날짜 자정 기준 현재 시각의 경과 분. 미래 날짜면 음수가 되어
  // 컷오프(nowMinutes + 리드타임)가 그만큼 앞당겨진다. 분수 분은 다음 분으로
  // 올림(분 절삭이 리드타임을 최대 59초 짧게 만들지 않도록 보수적 처리).
  const nowMinutes = Math.ceil(
    (now.getTime() - dayStartUtc.getTime()) / 60_000,
  );
  return buildTodaySlots({
    openMinutes: timeColumnToMinutes(openTime),
    closeMinutes: timeColumnToMinutes(closeTime),
    intervalMinutes: store.pickup_slot_interval_minutes,
    leadTimeMinutes: store.min_lead_time_minutes,
    nowMinutes,
  });
}
