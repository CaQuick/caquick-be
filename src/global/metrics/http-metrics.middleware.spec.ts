import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';

import {
  HttpMetricsMiddleware,
  routeLabel,
  UNMATCHED_ROUTE,
} from '@/global/metrics/http-metrics.middleware';
import { MetricsService } from '@/global/metrics/metrics.service';

function fakeReq(overrides: Record<string, unknown> = {}): Request {
  return { method: 'GET', path: '/x', ...overrides } as unknown as Request;
}
function fakeRes(statusCode: number): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  (res as { statusCode: number }).statusCode = statusCode;
  return res;
}

describe('HttpMetricsMiddleware', () => {
  it("응답 'finish'에 method·라우트 패턴·실제 상태 코드로 관측한다 — 가드 거절(401)도 인터셉터와 달리 잡힌다", async () => {
    const metrics = new MetricsService();
    const middleware = new HttpMetricsMiddleware(metrics);
    const req = fakeReq({ route: { path: '/auth/oidc/:provider/start' } });
    const res = fakeRes(401);
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    res.emit('finish');

    const text = await metrics.text();
    expect(text).toContain(
      'caquick_http_request_duration_seconds_count{method="GET",route="/auth/oidc/:provider/start",status="401"} 1',
    );
    expect(text).not.toContain('/x');
  });

  it('반증: 라우트가 매칭되지 않은 요청(404)은 <unmatched>로 — 실제 경로가 라벨로 새지 않는다', async () => {
    const metrics = new MetricsService();
    const res = fakeRes(404);
    new HttpMetricsMiddleware(metrics).use(
      fakeReq({ path: '/no/such/42' }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(await metrics.text()).toContain(
      `route="${UNMATCHED_ROUTE}",status="404"} 1`,
    );
    expect(routeLabel(fakeReq({ route: { path: 42 } }))).toBe(UNMATCHED_ROUTE);
  });

  it('처리 시간은 finish까지 초 단위로 잰다(_sum)', async () => {
    const metrics = new MetricsService();
    const now = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_250);
    const res = fakeRes(200);
    new HttpMetricsMiddleware(metrics).use(
      fakeReq({ route: { path: '/health/ready' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');
    now.mockRestore();

    expect(await metrics.text()).toContain(
      'caquick_http_request_duration_seconds_sum{method="GET",route="/health/ready",status="200"} 0.25',
    );
  });
});
