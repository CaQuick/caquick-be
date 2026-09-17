/**
 * store-pickup-schedule resolver 반환용 도메인 출력 타입.
 * SDL(store-pickup-schedule.graphql)의 타입과 필드 일치.
 */

export interface PickupDay {
  date: string;
  selectable: boolean;
  reason: string | null;
}

export interface PickupCalendar {
  yearMonth: string;
  days: PickupDay[];
}

export interface PickupSlot {
  time: string;
  available: boolean;
}

export interface PickupTimeSlots {
  date: string;
  morning: PickupSlot[];
  afternoon: PickupSlot[];
}
