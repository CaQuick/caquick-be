import { RequestContextService } from '@/global/request-context/request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('run() 안에서 get()/getClientIp()/getUserAgent() 가 컨텍스트를 반환한다', () => {
    service.run({ clientIp: '203.0.113.9', userAgent: 'jest-ua' }, () => {
      expect(service.get()).toEqual({
        clientIp: '203.0.113.9',
        userAgent: 'jest-ua',
      });
      expect(service.getClientIp()).toBe('203.0.113.9');
      expect(service.getUserAgent()).toBe('jest-ua');
    });
  });

  it('run() 밖에서는 undefined 를 반환한다', () => {
    expect(service.get()).toBeUndefined();
    expect(service.getClientIp()).toBeUndefined();
    expect(service.getUserAgent()).toBeUndefined();
  });

  it('async 경계(await)를 넘어도 컨텍스트가 유지된다', async () => {
    await service.run({ clientIp: '198.51.100.7' }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(service.getClientIp()).toBe('198.51.100.7');
    });
  });

  it('중첩 run() 은 안쪽 컨텍스트가 우선하고, 벗어나면 복원된다', () => {
    service.run({ clientIp: 'outer' }, () => {
      expect(service.getClientIp()).toBe('outer');
      service.run({ clientIp: 'inner' }, () => {
        expect(service.getClientIp()).toBe('inner');
      });
      expect(service.getClientIp()).toBe('outer');
    });
  });

  it('run() 콜백의 반환값을 그대로 전달한다', () => {
    const result = service.run({ clientIp: 'x' }, () => 42);
    expect(result).toBe(42);
  });
});
