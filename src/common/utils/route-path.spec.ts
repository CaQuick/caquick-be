import { normalizeRoutePath } from '@/common/utils/route-path';

describe('normalizeRoutePath', () => {
  it.each([
    ['/health/ready', '/health/ready'],
    ['/health/ready/', '/health/ready'],
    ['/HEALTH/READY//', '/health/ready'],
    ['/Metrics', '/metrics'],
    ['/', '/'],
    ['//', '/'],
    ['', '/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRoutePath(input)).toBe(expected);
  });
});
