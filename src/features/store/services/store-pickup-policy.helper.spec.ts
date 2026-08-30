import { kstMidnightUtc } from '@/common/utils/kst-time';
import {
  buildPickupDaySlots,
  buildTodaySlots,
  evaluatePickupDay,
  timeColumnToMinutes,
  type PickupDayInput,
} from '@/features/store/services/store-pickup-policy.helper';

const HOUR_MS = 60 * 60 * 1000;

/** @db.Time(0) 컬럼 표현(1970-01-01 UTC 기반)으로 시각 생성. */
function timeCol(hours: number, minutes = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
}

/** 해당 KST 날짜의 hh시(KST) 시각. */
function kstAt(year: number, month: number, day: number, hours: number): Date {
  return new Date(kstMidnightUtc(year, month, day).getTime() + hours * HOUR_MS);
}

describe('store-pickup-policy.helper', () => {
  // 기준일: 2026-09-10(KST), 영업 10:00~18:00, 간격 30분, 리드타임 60분, 7일 전 예약
  const DAY = { year: 2026, month: 9, day: 10 };
  const dayStartUtc = kstMidnightUtc(DAY.year, DAY.month, DAY.day);

  function input(overrides: Partial<PickupDayInput> = {}): PickupDayInput {
    return {
      store: {
        pickup_slot_interval_minutes: 30,
        min_lead_time_minutes: 60,
        max_days_ahead: 7,
      },
      hour: {
        is_closed: false,
        open_time: timeCol(10),
        close_time: timeCol(18),
      },
      isSpecialClosure: false,
      capacity: undefined,
      booked: 0,
      now: kstAt(DAY.year, DAY.month, DAY.day, 9),
      dayStartUtc,
      ...overrides,
    };
  }

  describe('evaluatePickupDay', () => {
    it('정상 영업일은 reason null과 가용 슬롯을 반환한다', () => {
      const result = evaluatePickupDay(input());
      expect(result.reason).toBeNull();
      // 10:00~17:30, 30분 간격 16개. 09:00+리드 60분 → 10:00부터 전부 가용
      expect(result.slots).toHaveLength(16);
      expect(result.slots.every((slot) => slot.available)).toBe(true);
    });

    it('과거 날짜는 PAST를 반환한다', () => {
      const result = evaluatePickupDay(
        input({ now: kstAt(DAY.year, DAY.month, DAY.day + 1, 9) }),
      );
      expect(result.reason).toBe('PAST');
    });

    it('max_days_ahead를 넘는 날짜는 OUT_OF_RANGE, 경계일은 허용한다', () => {
      const boundary = evaluatePickupDay(
        input({ now: kstAt(DAY.year, DAY.month, DAY.day - 7, 9) }),
      );
      expect(boundary.reason).toBeNull();

      const beyond = evaluatePickupDay(
        input({ now: kstAt(DAY.year, DAY.month, DAY.day - 8, 9) }),
      );
      expect(beyond.reason).toBe('OUT_OF_RANGE');
    });

    it('특별휴무일은 CLOSED이되 마감 표기용 슬롯은 반환한다', () => {
      const result = evaluatePickupDay(input({ isSpecialClosure: true }));
      expect(result.reason).toBe('CLOSED');
      expect(result.slots).toHaveLength(16);
    });

    it('영업시간 미설정·휴무 요일·시간 누락은 CLOSED와 빈 슬롯을 반환한다', () => {
      const cases: (PickupDayInput['hour'] | undefined)[] = [
        undefined,
        { is_closed: true, open_time: timeCol(10), close_time: timeCol(18) },
        { is_closed: false, open_time: null, close_time: timeCol(18) },
        { is_closed: false, open_time: timeCol(10), close_time: null },
      ];
      for (const hour of cases) {
        const result = evaluatePickupDay(input({ hour }));
        expect(result.reason).toBe('CLOSED');
        expect(result.slots).toEqual([]);
      }
    });

    it('점유 수량이 capacity에 도달하면 CAPACITY_FULL, 미달이면 통과한다', () => {
      expect(evaluatePickupDay(input({ capacity: 5, booked: 5 })).reason).toBe(
        'CAPACITY_FULL',
      );
      expect(
        evaluatePickupDay(input({ capacity: 5, booked: 4 })).reason,
      ).toBeNull();
    });

    it('capacity 레코드가 없으면 무제한으로 간주한다', () => {
      expect(
        evaluatePickupDay(input({ capacity: undefined, booked: 999 })).reason,
      ).toBeNull();
    });

    it('리드타임 반영 잔여 가용 슬롯이 없으면 CLOSED로 마감한다', () => {
      // 17:00 + 리드 60분 = 18:00 컷오프 → 17:30 슬롯까지 전부 마감
      const result = evaluatePickupDay(
        input({ now: kstAt(DAY.year, DAY.month, DAY.day, 17) }),
      );
      expect(result.reason).toBe('CLOSED');
      expect(result.slots).toHaveLength(16);
      expect(result.slots.every((slot) => !slot.available)).toBe(true);
    });

    it('과거이면서 특별휴무여도 PAST가 우선한다(판정 순서 고정)', () => {
      const result = evaluatePickupDay(
        input({
          now: kstAt(DAY.year, DAY.month, DAY.day + 1, 9),
          isSpecialClosure: true,
        }),
      );
      expect(result.reason).toBe('PAST');
    });
  });

  describe('buildPickupDaySlots', () => {
    const store = {
      pickup_slot_interval_minutes: 30,
      min_lead_time_minutes: 60,
      max_days_ahead: 7,
    };

    it('미래 날짜는 경과 분이 음수가 되어 컷오프가 앞당겨진다(전 슬롯 가용)', () => {
      const slots = buildPickupDaySlots(
        store,
        timeCol(10),
        timeCol(18),
        dayStartUtc,
        kstAt(DAY.year, DAY.month, DAY.day - 3, 23),
      );
      expect(slots.every((slot) => slot.available)).toBe(true);
    });

    it('초 단위가 남으면 다음 분으로 올려 리드타임을 보수적으로 적용한다', () => {
      // 09:00:30 + 리드 60분: 분 절삭이면 10:00 가용이지만, 올림으로 10:00은 마감
      const now = new Date(
        kstAt(DAY.year, DAY.month, DAY.day, 9).getTime() + 30 * 1000,
      );
      const slots = buildPickupDaySlots(
        store,
        timeCol(10),
        timeCol(18),
        dayStartUtc,
        now,
      );
      expect(slots[0]).toEqual({ time: '10:00', available: false });
      expect(slots[1]).toEqual({ time: '10:30', available: true });
    });
  });

  describe('buildTodaySlots', () => {
    it('영업시간을 간격대로 잘라 슬롯을 만들고 리드타임 이전은 마감 처리한다', () => {
      // 14:00~16:00, 30분 간격, 현재 14:20 + 리드 30분 → 14:50 이전 슬롯 마감
      const slots = buildTodaySlots({
        openMinutes: 14 * 60,
        closeMinutes: 16 * 60,
        intervalMinutes: 30,
        leadTimeMinutes: 30,
        nowMinutes: 14 * 60 + 20,
      });

      expect(slots).toEqual([
        { time: '14:00', available: false },
        { time: '14:30', available: false },
        { time: '15:00', available: true },
        { time: '15:30', available: true },
      ]);
    });

    it('close 시각 자체는 슬롯에 포함하지 않는다(미포함 경계)', () => {
      const slots = buildTodaySlots({
        openMinutes: 10 * 60,
        closeMinutes: 11 * 60,
        intervalMinutes: 60,
        leadTimeMinutes: 0,
        nowMinutes: 0,
      });

      expect(slots).toEqual([{ time: '10:00', available: true }]);
    });

    it('간격이 0 이하거나 영업시간이 뒤집힌 경우 빈 배열을 반환한다', () => {
      const base = {
        openMinutes: 10 * 60,
        closeMinutes: 12 * 60,
        leadTimeMinutes: 0,
        nowMinutes: 0,
      };

      expect(buildTodaySlots({ ...base, intervalMinutes: 0 })).toEqual([]);
      expect(
        buildTodaySlots({
          ...base,
          intervalMinutes: 30,
          openMinutes: 12 * 60,
          closeMinutes: 10 * 60,
        }),
      ).toEqual([]);
    });

    it('현재+리드타임이 영업 종료를 넘으면 전 슬롯이 마감된다', () => {
      const slots = buildTodaySlots({
        openMinutes: 10 * 60,
        closeMinutes: 12 * 60,
        intervalMinutes: 30,
        leadTimeMinutes: 60,
        nowMinutes: 11 * 60 + 30,
      });

      expect(slots.every((slot) => !slot.available)).toBe(true);
    });
  });

  describe('timeColumnToMinutes', () => {
    it('@db.Time 값(UTC 기반)을 자정 경과 분으로 변환한다', () => {
      expect(timeColumnToMinutes(new Date('1970-01-01T10:30:00Z'))).toBe(630);
      expect(timeColumnToMinutes(new Date('1970-01-01T00:00:00Z'))).toBe(0);
    });
  });
});
