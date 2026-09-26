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
import {
  fieldDurationSeconds,
  markFieldStart,
} from '@/global/metrics/graphql-field-timing';
import { MetricsService } from '@/global/metrics/metrics.service';
import { LogContext } from '@/global/types/log.type';

/** 루트(Query/Mutation) 레벨만 로깅한다. */
@Injectable()
export class GqlLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: CustomLoggerService,
    private readonly metrics: MetricsService,
  ) {}

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
    // 루트 필드별 시작 — 요청 시작으로 재면 루트 필드가 여럿일 때 뒤 필드가 앞 시간을 떠안는다
    markFieldStart(info);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = calculateDuration(startTime);

          this.logger.tx({
            ...baseLog,
            processingTimeInMs: duration,
          });

          setResponseTimeHeader(res, duration);
          // 라벨은 스키마가 정하는 루트 필드명 — operationName은 클라이언트가 정해 카디널리티가 무한하다
          this.metrics.graphqlRootFieldDuration.observe(
            { type: parentType, field: info.fieldName, outcome: 'ok' },
            fieldDurationSeconds(info),
          );
        },
        // 실패는 GraphQLExceptionFilter가 outcome=분류로 센다(가드 거절까지 포함)
        error: () => {
          setResponseTimeHeader(res, calculateDuration(startTime));
        },
      }),
    );
  }
}
