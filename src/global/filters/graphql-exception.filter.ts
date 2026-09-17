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
 * GraphQL 컨텍스트 전용 예외 포맷터.
 *
 * NestJS 글로벌 필터는 host type 별로 1 회만 매칭되므로 별도 글로벌 등록 대신
 * `HttpExceptionFilter` 가 graphql context 일 때 본 클래스에 위임한다.
 *
 * extensions:
 * - code           : 카탈로그 에러 코드(정본). 필터 밖 예외는 VALIDATION_FAILED / INTERNAL_ERROR
 * - classification : Apollo 관례 분류(BAD_USER_INPUT / UNAUTHENTICATED / FORBIDDEN / NOT_FOUND / CONFLICT / INTERNAL_SERVER_ERROR)
 * - statusCode     : 400 / 401 / 403 / 404 / 409 / 500
 * - requestId   : x-request-id (트래킹용)
 * - operation   : query / mutation / subscription
 * - fieldName   : 루트 필드명
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
