import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';

import { ApiResponseTemplate } from 'src/global/types/response';

const DEFAULT_EXCLUDE_PATHS = new Set<string>();

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
