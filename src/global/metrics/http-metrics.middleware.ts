import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from '@/global/metrics/metrics.service';

/** 컨트롤러 Route도 app.use 마운트도 아닌 요청(404·워커 차단). 실제 경로를 라벨로 쓰면 id 하나마다 시계열이 생긴다. */
export const UNMATCHED_ROUTE = '<unmatched>';
/** 클라이언트가 응답 전에 끊은 요청 — 상태 코드가 보내진 적이 없다. */
export const ABORTED_STATUS = 'aborted';

/**
 * HTTP 요청 히스토그램. 인터셉터가 아니라 Express 'finish'에서 잰다 — 인터셉터는 가드 뒤에 돌아 401·403은
 * 아예 못 보고, 오류의 최종 상태는 필터가 정해 알 수 없었다. 여기서는 404·가드 거절·필터 결과가 전부 실제 상태 코드로 잡힌다.
 * 클라이언트가 끊으면 'finish'가 오지 않고 'close'만 온다 — 그 요청도 세지 않으면 타임아웃 사고가 지표에서 사라진다.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = performance.now();
    // 이 미들웨어 자체가 '*path' Route라 진입 시 req.route가 이미 채워져 있다 — 끝날 때 바뀐 것만 컨트롤러 매칭이다
    const entered: unknown = (req as { route?: unknown }).route;
    let observed = false;
    const observe = (finished: boolean) => {
      if (observed) return;
      observed = true;
      this.metrics.httpRequestDuration.observe(
        {
          method: req.method,
          route: routeLabel(req, entered),
          status: finished ? String(res.statusCode) : ABORTED_STATUS,
        },
        (performance.now() - startedAt) / 1000,
      );
    };
    res.once('finish', () => observe(true));
    res.once('close', () => observe(false));
    next();
  }
}

/**
 * Nest 미들웨어는 app.all('*path')로 걸려 req.route가 '/*path'이고, 뒤의 다른 '*path' 미들웨어(워커 차단)가 또 다른 '/*path'로
 * 바꿀 수 있다 — 와일드카드 패턴은 매칭이 아니다. app.use 마운트(Apollo /graphql)는 req.route를 안 바꾸고 baseUrl만 남긴다.
 * 마운트 경로는 코드가 정한 정적 값이라 라벨로 안전하다.
 */
export function routeLabel(req: Request, entered?: unknown): string {
  const route: unknown = (req as { route?: unknown }).route;
  const path: unknown =
    typeof route === 'object' && route !== null
      ? (route as { path?: unknown }).path
      : undefined;
  if (route !== entered && typeof path === 'string' && !path.includes('*')) {
    return path;
  }
  if (typeof req.baseUrl === 'string' && req.baseUrl !== '') return req.baseUrl;
  return UNMATCHED_ROUTE;
}
