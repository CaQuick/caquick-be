import { formatMinutesOfDay } from '@/common/utils/kst-time';
import type { TodayPickupSlot } from '@/features/store/types/store-today-pickup-output.type';

export interface TodaySlotPolicy {
  /** 영업 시작(자정 경과 분). */
  openMinutes: number;
  /** 영업 종료(자정 경과 분, 미포함 — 마지막 슬롯은 close-interval). */
  closeMinutes: number;
  /** 슬롯 간격(분). */
  intervalMinutes: number;
  /** 최소 리드타임(분). now+lead 이전 슬롯은 마감. */
  leadTimeMinutes: number;
  /** 현재 시각(자정 경과 분). */
  nowMinutes: number;
}

/**
 * 오늘 영업시간 [open, close) 를 간격대로 잘라 슬롯을 만든다.
 * 리드타임(now+lead) 이전 슬롯은 available=false로 표기한다(UI 회색 슬롯).
 * 슬롯 단위 예약 점유는 capacity가 일(日) 단위 모델이라 표현하지 않는다 —
 * capacity 소진은 호출부에서 매장 자체를 제외한다(figma 명세 외 정책 결정).
 */
export function buildTodaySlots(policy: TodaySlotPolicy): TodayPickupSlot[] {
  if (
    policy.intervalMinutes <= 0 ||
    policy.closeMinutes <= policy.openMinutes
  ) {
    return [];
  }
  const cutoff = policy.nowMinutes + policy.leadTimeMinutes;
  const slots: TodayPickupSlot[] = [];
  for (
    let t = policy.openMinutes;
    t < policy.closeMinutes;
    t += policy.intervalMinutes
  ) {
    slots.push({ time: formatMinutesOfDay(t), available: t >= cutoff });
  }
  return slots;
}

/** Prisma @db.Time(0) 값(1970-01-01 UTC 기반)을 자정 경과 분으로 변환. */
export function timeColumnToMinutes(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}
