import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ERROR_CATALOG } from '@/common/errors/error-catalog';
import { isWorkerRouteAllowed } from '@/config/app.config';
import { ApiResponseTemplate } from '@/global/types/response';

/**
 * worker 역할의 리스너는 헬스(·메트릭)만 연다. feature 모듈의 REST 컨트롤러(/auth/*, JWKS)는 모듈과 함께 실리므로
 * 여기서 막지 않으면 worker 복제본에서도 응답한다. 응답은 라우트 없음과 같은 봉투(404·ROUTE_NOT_FOUND).
 */
@Injectable()
export class WorkerRouteMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (isWorkerRouteAllowed(req.path)) {
      next();
      return;
    }
    res
      .status(HttpStatus.NOT_FOUND)
      .json(
        ApiResponseTemplate.ERROR(
          ERROR_CATALOG.ROUTE_NOT_FOUND.message,
          HttpStatus.NOT_FOUND,
          'ROUTE_NOT_FOUND',
        ),
      );
  }
}
