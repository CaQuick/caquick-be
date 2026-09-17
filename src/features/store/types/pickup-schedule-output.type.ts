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
