import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { MetricsAccessMiddleware } from '@/global/metrics/metrics-access.middleware';

function build(accessToken: string | null) {
  const middleware = new MetricsAccessMiddleware({
    getOrThrow: () => ({ accessToken }),
  } as unknown as ConfigService);
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock };
  const next = jest.fn();
  const run = (authorization?: string) =>
    middleware.use({ headers: { authorization } } as Request, res, next);
  return { run, res, next };
}

describe('MetricsAccessMiddleware', () => {
  it('토큰이 설정돼 있지 않으면(로컬·CI) 연다', () => {
    const { run, next } = build(null);
    run();
    expect(next).toHaveBeenCalled();
  });

  it('Bearer 토큰이 맞으면 통과', () => {
    const { run, next } = build('secret');
    run('Bearer secret');
    expect(next).toHaveBeenCalled();
  });

  it.each<[string | undefined, string]>([
    [undefined, '헤더 없음'],
    ['Bearer wrong', '틀린 토큰'],
    ['Bearer secre', '길이 다름'],
    ['Basic c2VjcmV0', 'Bearer가 아닌 스킴'],
    ['secret', '스킴 없음'],
  ])('반증: %s(%s) → 401 + WWW-Authenticate', (header) => {
    const { run, res, next } = build('secret');
    run(header);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer realm="metrics"',
    );
  });
});
