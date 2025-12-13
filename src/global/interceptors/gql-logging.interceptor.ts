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
} from 'src/common/utils/request-context';
import { CustomLoggerService } from 'src/global/logger/custom-logger.service';
import { LogContext } from 'src/global/types/log.type';

/**
 * GraphQL 요청/응답을 로깅하는 인터셉터.
 * - 루트(Query/Mutation) 레벨만 로깅한다.
 */
@Injectable()
export class GqlLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: CustomLoggerService) {}

  /**
   * GraphQL 실행 컨텍스트에서 메타데이터를 수집하고,
   * 성공/에러 모두에 대해 트랜잭션 로그를 남긴다.
   */
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
        error: (error: unknown) => {
          const duration = calculateDuration(startTime);

          this.logger.txError({
            ...baseLog,
            processingTimeInMs: duration,
            error: {
              message: error instanceof Error ? error.message : 'Unknown error',
              stack: error instanceof Error ? error.stack : undefined,
            },
          });

          setResponseTimeHeader(res, duration);
        },
      }),
    );
  }
}
