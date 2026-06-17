import { BadRequestException, Injectable } from '@nestjs/common';

import {
  formatKstDate,
  formatMinutesOfDay,
  kstDayDiff,
  kstMidnightUtc,
  kstMinutesOfDay,
  parseKstDate,
  parseKstYearMonth,
} from '@/common/utils/kst-time';
import {
  PICKUP_DAY_REASON,
  PICKUP_ERRORS,
} from '@/features/pickup/constants/pickup-error-messages';
import {
  PICKUP_AFTERNOON_START_MINUTES,
  PICKUP_CLOSE_MINUTES,
  PICKUP_MAX_DAYS_AHEAD,
  PICKUP_MIN_LEAD_MINUTES,
  PICKUP_OPEN_MINUTES,
  PICKUP_SLOT_INTERVAL_MINUTES,
} from '@/features/pickup/constants/pickup.constants';
import type {
  PickupCalendar,
  PickupSlot,
  PickupTimeSlots,
} from '@/features/pickup/types/pickup-output.type';

@Injectable()
export class PickupSlotService {
  /**
   * 월별 픽업 가능 날짜. KST 기준 과거는 PAST, 오늘+최대일수 초과는 OUT_OF_RANGE로
   * 선택 불가 처리한다. now는 테스트 주입용.
   */
  pickupCalendar(yearMonth: string, now: Date = new Date()): PickupCalendar {
    const ym = parseKstYearMonth(yearMonth);
    if (!ym) {
      throw new BadRequestException(PICKUP_ERRORS.INVALID_YEAR_MONTH);
    }

    const daysInMonth = new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();

    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = kstMidnightUtc(ym.year, ym.month, day);
      const diff = kstDayDiff(now, date);

      if (diff < 0) {
        return {
          date: formatKstDate(date),
          selectable: false,
          reason: PICKUP_DAY_REASON.PAST,
        };
      }
      if (diff > PICKUP_MAX_DAYS_AHEAD) {
        return {
          date: formatKstDate(date),
          selectable: false,
          reason: PICKUP_DAY_REASON.OUT_OF_RANGE,
        };
      }
      return { date: formatKstDate(date), selectable: true, reason: null };
    });

    return { yearMonth, days };
  }

  /**
   * 특정 날짜의 시간 슬롯(오전/오후). 당일은 현재시각+리드타임 이전 슬롯을 마감,
   * 과거/범위 초과 날짜는 전부 마감 처리한다. now는 테스트 주입용.
   */
  pickupTimeSlots(date: string, now: Date = new Date()): PickupTimeSlots {
    const parsed = parseKstDate(date);
    if (!parsed) {
      throw new BadRequestException(PICKUP_ERRORS.INVALID_DATE);
    }

    const diff = kstDayDiff(now, parsed);
    const outOfRange = diff < 0 || diff > PICKUP_MAX_DAYS_AHEAD;
    const isToday = diff === 0;
    const cutoffMinutes = isToday
      ? kstMinutesOfDay(now) + PICKUP_MIN_LEAD_MINUTES
      : Number.NEGATIVE_INFINITY;

    const morning: PickupSlot[] = [];
    const afternoon: PickupSlot[] = [];

    for (
      let minutes = PICKUP_OPEN_MINUTES;
      minutes < PICKUP_CLOSE_MINUTES;
      minutes += PICKUP_SLOT_INTERVAL_MINUTES
    ) {
      const slot: PickupSlot = {
        time: formatMinutesOfDay(minutes),
        available: !outOfRange && minutes >= cutoffMinutes,
      };
      if (minutes < PICKUP_AFTERNOON_START_MINUTES) {
        morning.push(slot);
      } else {
        afternoon.push(slot);
      }
    }

    return { date, morning, afternoon };
  }
}
