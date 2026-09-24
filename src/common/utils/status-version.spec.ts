import { nextStatusChangedAt } from '@/common/utils/status-version';

const NOW = new Date('2026-09-25T12:00:00.000Z');

describe('nextStatusChangedAt', () => {
  it.each([
    ['이전 값 없음', null, NOW],
    ['이전 값이 과거', new Date(NOW.getTime() - 1), NOW],
    ['이전 값이 같은 ms', NOW, new Date(NOW.getTime() + 1)],
    [
      '이전 값이 미래(다른 복제본 시계)',
      new Date(NOW.getTime() + 500),
      new Date(NOW.getTime() + 501),
    ],
  ])('%s → 항상 이전 값보다 크다', (_, previous, expected) => {
    const next = nextStatusChangedAt(NOW, previous);
    expect(next).toEqual(expected);
    if (previous) expect(next.getTime()).toBeGreaterThan(previous.getTime());
  });
});
