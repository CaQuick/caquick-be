import { ArgumentsHost, HttpStatus, Injectable } from '@nestjs/common';
import { GqlArgumentsHost } from '@nestjs/graphql';
import type { Request } from 'express';
import { GraphQLError, type GraphQLResolveInfo } from 'graphql';

import { resolveMessage, resolveStatus } from '@/common/utils/error';
import {
  buildGraphqlRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  resolveUserId,
} from '@/common/utils/request-context';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { LogContext } from '@/global/types/log.type';

/**
 * HTTP status code → GraphQL extensions.code 매핑.
 * Apollo 권장 표준 코드를 따른다. 알 수 없는 status 는 INTERNAL_SERVER_ERROR.
 */
const STATUS_TO_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_USER_INPUT',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

export function mapStatusToCode(status: number): string {
  return STATUS_TO_CODE[status] ?? 'INTERNAL_SERVER_ERROR';
}

/**
 * GraphQL 컨텍스트 전용 예외 포맷터.
 *
 * NestJS 글로벌 필터는 host type 별로 1 회만 매칭되므로 별도 글로벌 등록 대신
 * `HttpExceptionFilter` 가 graphql context 일 때 본 클래스에 위임한다.
 *
 * extensions:
 * - code        : BAD_USER_INPUT / UNAUTHENTICATED / FORBIDDEN / NOT_FOUND / INTERNAL_SERVER_ERROR
 * - statusCode  : 400 / 401 / 403 / 404 / 500
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
        code: mapStatusToCode(status),
        statusCode: status,
        requestId,
        operation: info.operation.operation,
        fieldName: info.fieldName,
      },
    });
  }
}
