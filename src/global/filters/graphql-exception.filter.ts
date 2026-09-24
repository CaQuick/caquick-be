import { ArgumentsHost, Injectable } from '@nestjs/common';
import { GqlArgumentsHost } from '@nestjs/graphql';
import type { Request } from 'express';
import { GraphQLError, type GraphQLResolveInfo } from 'graphql';

import {
  classifyStatus,
  resolveErrorCode,
  resolveMessage,
  resolveStatus,
} from '@/common/utils/error';
import {
  buildGraphqlRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  resolveUserId,
} from '@/common/utils/request-context';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { fieldDurationSeconds } from '@/global/metrics/graphql-field-timing';
import { MetricsService } from '@/global/metrics/metrics.service';
import { LogContext } from '@/global/types/log.type';

/**
 * NestJS 글로벌 필터는 host type별로 1회만 매칭되므로 별도 글로벌 등록 대신 HttpExceptionFilter가 graphql context일 때 위임한다.
 * extensions.code는 카탈로그 코드(정본), classification은 Apollo 관례 분류, 나머지(statusCode·requestId·operation·fieldName)는 트래킹용.
 */
@Injectable()
export class GraphQLExceptionFilter {
  constructor(
    private readonly logger: CustomLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  format(exception: unknown, host: ArgumentsHost): GraphQLError {
    const gqlHost = GqlArgumentsHost.create(host);
    const info = gqlHost.getInfo<GraphQLResolveInfo>();
    const ctx = gqlHost.getContext<{ req: Request }>();
    const req = ctx.req;

    const { requestId, startTime } = ensureRequestTracking(req);
    const userId = resolveUserId(req);
    const gqlRequest = buildGraphqlRequestMeta(info, req);

    const status = resolveStatus(exception);
    const message = resolveMessage(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const duration = calculateDuration(startTime);

    this.logger.txError({
      userId,
      requestId,
      request: gqlRequest,
      error: { statusCode: status, message, stack },
      processingTimeInMs: duration,
      context: LogContext.GRAPHQL,
    });
    // 인터셉터는 가드 뒤에 돌아 401·403을 못 본다 — 실패 관측은 여기서, outcome은 유한한 분류(4xx·5xx 구분).
    // 인터셉터와 같은 범위(Query·Mutation 루트)만 — 구독은 성공을 세지 않으므로 실패만 세면 오류율이 왜곡된다
    const parentType = info.parentType.toString();
    if (parentType === 'Query' || parentType === 'Mutation') {
      this.metrics.graphqlRootFieldDuration.observe(
        {
          type: parentType,
          field: info.fieldName,
          outcome: classifyStatus(status),
        },
        fieldDurationSeconds(info),
      );
    }

    return new GraphQLError(message, {
      extensions: {
        code: resolveErrorCode(exception),
        classification: classifyStatus(status),
        statusCode: status,
        requestId,
        operation: info.operation.operation,
        fieldName: info.fieldName,
      },
    });
  }
}
