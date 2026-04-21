import { PingResolver } from '@/features/system/resolvers/ping.resolver';

describe('PingResolver', () => {
  it('ping Query는 pong을 반환한다', () => {
    const resolver = new PingResolver();
    expect(resolver.ping()).toBe('pong');
  });
});
