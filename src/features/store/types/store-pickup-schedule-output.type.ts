/**
 * store-pickup-schedule resolver 반환용 도메인 출력 타입.
 * SDL(store-pickup-schedule.graphql)의 타입과 필드 일치.
 */

export interface StorePickupDay {
  date: string;
  selectable: boolean;
  reason: string | null;
}

export interface StorePickupCalendar {
  yearMonth: string;
  days: StorePickupDay[];
}

export interface StorePickupSlot {
  time: string;
  available: boolean;
}

export interface StorePickupTimeSlots {
  date: string;
  morning: StorePickupSlot[];
  afternoon: StorePickupSlot[];
}
