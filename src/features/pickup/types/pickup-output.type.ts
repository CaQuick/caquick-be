/**
 * pickup resolver 반환용 도메인 출력 타입.
 * SDL(pickup.types.graphql)과 필드 일치.
 */

export interface PickupDay {
  date: string; // "YYYY-MM-DD"
  selectable: boolean;
  reason: string | null; // PAST | OUT_OF_RANGE (선택 가능 시 null)
}

export interface PickupCalendar {
  yearMonth: string; // "YYYY-MM"
  days: PickupDay[];
}

export interface PickupSlot {
  time: string; // "HH:MM"
  available: boolean;
}

export interface PickupTimeSlots {
  date: string;
  morning: PickupSlot[];
  afternoon: PickupSlot[];
}
