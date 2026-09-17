import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { GqlContextType } from '@nestjs/graphql';
import type { Request, Response } from 'express';
import type { GraphQLResolveInfo } from 'graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import {
  buildGraphqlRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  resolveUserId,
  setResponseTimeHeader,
} from '@/common/utils/request-context';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { LogContext } from '@/global/types/log.type';

/** 루트(Query/Mutation) 레벨만 로깅한다. */
@Injectable()
export class GqlLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: CustomLoggerService) {}

  /** 에러 로깅은 GraphQLExceptionFilter가 담당하지만, 에러 응답에도 response time header가 누락되지 않도록 setResponseTimeHeader는 여기서 유지한다. */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType<GqlContextType>();

    if (type !== 'graphql') {
      return next.handle();
    }

    const gqlCtx = GqlExecutionContext.create(context);
    const { req, res } = gqlCtx.getContext<{ req: Request; res?: Response }>();
    const info = gqlCtx.getInfo<GraphQLResolveInfo>();

    const parentType = info.parentType?.toString();
    if (parentType !== 'Query' && parentType !== 'Mutation') {
      return next.handle();
    }

    const { requestId, startTime } = ensureRequestTracking(req, res);
    const userId = resolveUserId(req);
    const gqlRequest = buildGraphqlRequestMeta(info, req);

    const baseLog = {
      userId,
      requestId,
      request: gqlRequest,
      context: LogContext.GRAPHQL as const,
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = calculateDuration(startTime);

          this.logger.tx({
            ...baseLog,
            processingTimeInMs: duration,
          });

          setResponseTimeHeader(res, duration);
        },
        error: () => {
          const duration = calculateDuration(startTime);
          setResponseTimeHeader(res, duration);
        },
      }),
    );
  }
}
