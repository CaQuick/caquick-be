import { ClockService } from '@/common/providers/clock.service';

describe('ClockService', () => {
  const clock = new ClockService();

  describe('now', () => {
    it('현재 시각 근처의 Date를 반환한다', () => {
      const before = Date.now();
      const result = clock.now();
      const after = Date.now();

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('호출마다 새로운 Date 인스턴스를 반환한다', () => {
      const a = clock.now();
      const b = clock.now();
      expect(a).not.toBe(b);
    });
  });

  describe('nowMs', () => {
    it('Date.now()와 동일한 범위의 밀리초를 반환한다', () => {
      const before = Date.now();
      const result = clock.nowMs();
      const after = Date.now();

      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it('정수를 반환한다', () => {
      expect(Number.isInteger(clock.nowMs())).toBe(true);
    });
  });
});
