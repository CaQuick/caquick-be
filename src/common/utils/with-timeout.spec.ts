import { withTimeout } from '@/common/utils/with-timeout';

describe('withTimeout', () => {
  it('기한 안에 끝나면 값을 그대로 돌려준다', async () => {
    await expect(withTimeout(Promise.resolve(1), 50, 'x')).resolves.toBe(1);
  });

  it('원 promise의 거부는 그대로 전파한다', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 50, 'x'),
    ).rejects.toThrow('boom');
  });

  it('반증: 기한을 넘기면 라벨과 ms를 담아 거부한다', async () => {
    const never = new Promise<void>(() => undefined);
    await expect(withTimeout(never, 10, 'redis ping')).rejects.toThrow(
      'redis ping 10ms 초과',
    );
  });
});
