import {
  formatKstDate,
  formatMinutesOfDay,
  kstDayDiff,
  kstMidnightUtc,
  kstMinutesOfDay,
  parseKstDate,
  parseKstYearMonth,
  toKstYmd,
} from '@/common/utils/kst-time';

describe('kst-time', () => {
  describe('toKstYmd / formatKstDate (KST 경계)', () => {
    it('UTC 15:00은 KST 다음날 00:00이다', () => {
      const date = new Date('2026-06-17T15:00:00.000Z');
      expect(toKstYmd(date)).toEqual({ year: 2026, month: 6, day: 18 });
      expect(formatKstDate(date)).toBe('2026-06-18');
    });

    it('UTC 14:59:59는 아직 KST 같은 날이다', () => {
      const date = new Date('2026-06-17T14:59:59.000Z');
      expect(formatKstDate(date)).toBe('2026-06-17');
    });
  });

  describe('kstMinutesOfDay', () => {
    it('KST 시각의 자정 경과 분을 반환한다', () => {
      // UTC 01:30 = KST 10:30 = 630분
      expect(kstMinutesOfDay(new Date('2026-06-18T01:30:00.000Z'))).toBe(630);
    });
  });

  describe('parseKstYearMonth', () => {
    it('유효한 YYYY-MM 파싱', () => {
      expect(parseKstYearMonth('2026-06')).toEqual({ year: 2026, month: 6 });
    });
    it('형식/범위 오류는 null', () => {
      expect(parseKstYearMonth('2026-13')).toBeNull();
      expect(parseKstYearMonth('2026-6')).toBeNull();
      expect(parseKstYearMonth('not-a-month')).toBeNull();
    });
  });

  describe('parseKstDate', () => {
    it('KST 자정에 해당하는 UTC Date로 변환한다', () => {
      // 2026-06-18 00:00 KST = 2026-06-17 15:00 UTC
      const date = parseKstDate('2026-06-18');
      expect(date?.toISOString()).toBe('2026-06-17T15:00:00.000Z');
    });
    it('존재하지 않는 날짜(2026-02-30)는 null', () => {
      expect(parseKstDate('2026-02-30')).toBeNull();
    });
    it('형식 오류는 null', () => {
      expect(parseKstDate('2026/06/18')).toBeNull();
      expect(parseKstDate('2026-06')).toBeNull();
    });
  });

  describe('kstMidnightUtc', () => {
    it('KST 자정에 해당하는 UTC Date를 만든다', () => {
      expect(kstMidnightUtc(2026, 6, 18).toISOString()).toBe(
        '2026-06-17T15:00:00.000Z',
      );
    });
  });

  describe('kstDayDiff', () => {
    it('같은 KST 날짜는 0', () => {
      const a = new Date('2026-06-18T01:00:00.000Z'); // KST 06-18 10:00
      const b = new Date('2026-06-18T10:00:00.000Z'); // KST 06-18 19:00
      expect(kstDayDiff(a, b)).toBe(0);
    });
    it('다음날은 1, 이전날은 -1', () => {
      const today = new Date('2026-06-18T01:00:00.000Z'); // KST 06-18
      expect(kstDayDiff(today, new Date('2026-06-19T01:00:00.000Z'))).toBe(1);
      expect(kstDayDiff(today, new Date('2026-06-17T01:00:00.000Z'))).toBe(-1);
    });
    it('UTC 자정 경계를 넘어도 KST 기준으로 센다', () => {
      // UTC 15:00 = KST 익일 00:00 → 하루 차이
      const a = new Date('2026-06-17T14:00:00.000Z'); // KST 06-17 23:00
      const b = new Date('2026-06-17T15:00:00.000Z'); // KST 06-18 00:00
      expect(kstDayDiff(a, b)).toBe(1);
    });
  });

  describe('formatMinutesOfDay', () => {
    it('분을 HH:MM으로 포맷', () => {
      expect(formatMinutesOfDay(630)).toBe('10:30');
      expect(formatMinutesOfDay(0)).toBe('00:00');
      expect(formatMinutesOfDay(1170)).toBe('19:30');
    });
  });
});
