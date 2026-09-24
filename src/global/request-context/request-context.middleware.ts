import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { tryClientIp, tryUserAgent } from '@/common/utils/http-meta';
import { ensureRequestTracking } from '@/common/utils/request-context';
import { RequestContextService } from '@/global/request-context/request-context.service';

/** `next()`를 `run()` 콜백 안에서 호출해야 이후 핸들러 체인이 컨텍스트 안에서 실행된다(ALS 전파의 전제). IP 추출은 tryClientIp(trust proxy 기반)에 위임한다. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // requestId는 여기서 확정한다 — 인터셉터보다 먼저라 ALS를 통해 모든 로그 줄이 같은 값을 갖는다.
    const { requestId } = ensureRequestTracking(req, res);
    this.requestContext.run(
      {
        clientIp: tryClientIp(req),
        userAgent: tryUserAgent(req),
        requestId,
      },
      () => next(),
    );
  }
}
