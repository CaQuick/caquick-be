import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import {
  buildHttpRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  resolveUserId,
  setResponseTimeHeader,
} from '@/common/utils/request-context';
import { normalizeRoutePath } from '@/common/utils/route-path';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { LogContext } from '@/global/types/log.type';

/** GraphQL 이외의 http 컨텍스트에 대해서만 동작한다. */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: CustomLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http'>() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { requestId, startTime } = ensureRequestTracking(req, res);
    const userId = resolveUserId(req);
    const requestMeta = buildHttpRequestMeta(req);
    // compose·Prometheus가 몇 초마다 두드리는 경로 — 정상 응답은 줄마다 Loki에 실리면 상시 소음이라 tx 로그를 생략(헤더는 유지).
    // 실패(4xx·5xx, 예: ready 503)는 남긴다 — 무엇이 죽었는지 로그로 봐야 한다.
    const probe = isProbePath(req.path);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = calculateDuration(startTime);

          const statusCode = res.statusCode || HttpStatus.OK;
          if (probe && statusCode < 400) {
            setResponseTimeHeader(res, duration);
            return;
          }
          this.logger.tx({
            userId,
            requestId,
            request: requestMeta,
            response: { statusCode },
            processingTimeInMs: duration,
            context: LogContext.REST,
          });

          setResponseTimeHeader(res, duration);
        },
      }),
    );
  }
}

/** /health*·/metrics — 프로브 전용 경로(대소문자·끝 슬래시 무시 — 라우팅과 같은 기준) */
export function isProbePath(path: string): boolean {
  const normalized = normalizeRoutePath(path);
  return (
    normalized === '/health' ||
    normalized.startsWith('/health/') ||
    normalized === '/metrics'
  );
}
