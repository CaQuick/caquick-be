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
} from 'src/common/utils/request-context';
import { CustomLoggerService } from 'src/global/logger/custom-logger.service';
import { LogContext } from 'src/global/types/log.type';

/**
 * REST HTTP 요청/응답을 로깅하는 인터셉터.
 * - GraphQL 이외의 http 컨텍스트에 대해서만 동작한다.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: CustomLoggerService) {}

  /**
   * 요청 메타데이터를 수집하고, 응답 시점에 트랜잭션 로그를 남긴다.
   *
   * @param context 실행 컨텍스트
   * @param next 다음 핸들러
   */
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

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = calculateDuration(startTime);

          this.logger.log({
            userId,
            requestId,
            request: requestMeta,
            response: { statusCode: res.statusCode || HttpStatus.OK },
            processingTimeInMs: duration,
            context: LogContext.REST,
          });

          setResponseTimeHeader(res, duration);
        },
      }),
    );
  }
}
