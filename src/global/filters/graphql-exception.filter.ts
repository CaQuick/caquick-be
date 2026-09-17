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
import { LogContext } from '@/global/types/log.type';

/**
 * NestJS 글로벌 필터는 host type별로 1회만 매칭되므로 별도 글로벌 등록 대신 HttpExceptionFilter가 graphql context일 때 위임한다.
 * extensions.code는 카탈로그 코드(정본), classification은 Apollo 관례 분류, 나머지(statusCode·requestId·operation·fieldName)는 트래킹용.
 */
@Injectable()
export class GraphQLExceptionFilter {
  constructor(private readonly logger: CustomLoggerService) {}

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
