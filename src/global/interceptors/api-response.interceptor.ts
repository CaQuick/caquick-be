import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';

import { ApiResponseTemplate } from '@/global/types/response';

const DEFAULT_EXCLUDE_PATHS = new Set<string>();

/**
 * 전역 봉투를 씌우지 않는 경로. 응답 형태가 우리 계약이 아니라 **외부 표준**으로 정해진 자리다 —
 * 표준 클라이언트(JWKS는 jose·jwks-rsa·라우터)가 최상위 필드를 그대로 기대하므로 감싸면 읽지 못한다.
 * main.ts가 이 목록으로 인터셉터를 만든다(main.ts는 커버리지 대상이 아니라 검증은 spec이 이 상수로 한다).
 */
export const RAW_RESPONSE_PATHS: ReadonlySet<string> = new Set([
  '/health',
  '/health/profiles',
  '/.well-known/jwks.json',
]);

export class ApiResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly excludePaths: ReadonlySet<string> = DEFAULT_EXCLUDE_PATHS,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http'>() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path;

    return next.handle().pipe(
      map((data: unknown) => {
        if (this.excludePaths.has(path)) {
          return data;
        }
        if (data instanceof ApiResponseTemplate) {
          return data;
        }
        if (data === undefined) {
          return ApiResponseTemplate.SUCCESS();
        }
        return ApiResponseTemplate.SUCCESS_WITH_DATA(data);
      }),
    );
  }
}
