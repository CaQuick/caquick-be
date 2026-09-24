import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from '@/global/metrics/metrics.service';

/** 라우터가 매칭한 패턴(/auth/oidc/:provider/start). id가 라벨로 새면 카디널리티가 터지므로 실제 경로는 쓰지 않는다. */
export const UNMATCHED_ROUTE = '<unmatched>';

/**
 * HTTP 요청 히스토그램(P2 05). 인터셉터가 아니라 Express 'finish'에서 잰다 — 인터셉터는 가드 뒤에 돌아 401·403은
 * 아예 못 보고, 오류의 최종 상태는 필터가 정해 알 수 없었다. 여기서는 404·가드 거절·필터 결과가 전부 실제 상태 코드로 잡힌다.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = performance.now();
    res.once('finish', () => {
      this.metrics.httpRequestDuration.observe(
        {
          method: req.method,
          route: routeLabel(req),
          status: String(res.statusCode),
        },
        (performance.now() - startedAt) / 1000,
      );
    });
    next();
  }
}

export function routeLabel(req: Request): string {
  const route: unknown = (req as { route?: unknown }).route;
  if (
    typeof route === 'object' &&
    route !== null &&
    typeof (route as { path?: unknown }).path === 'string'
  ) {
    return (route as { path: string }).path;
  }
  return UNMATCHED_ROUTE;
}
