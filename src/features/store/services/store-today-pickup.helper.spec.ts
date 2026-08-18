import {
  buildTodaySlots,
  timeColumnToMinutes,
} from '@/features/store/services/store-today-pickup.helper';

describe('store-today-pickup.helper', () => {
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
