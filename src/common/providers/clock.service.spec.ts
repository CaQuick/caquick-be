import { ClockService } from '@/common/providers/clock.service';

describe('ClockService', () => {
  const clock = new ClockService();

  it('now()가 Date 인스턴스를 반환한다', () => {
    expect(clock.now()).toBeInstanceOf(Date);
  });

  it('nowMs()가 현재 시각의 밀리초를 반환한다', () => {
    const before = Date.now();
    const result = clock.nowMs();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});
