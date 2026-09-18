import { ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { AbstractHttpAdapter, BaseExceptionFilter } from '@nestjs/core';
import type { GqlContextType } from '@nestjs/graphql';
import type { Request, Response } from 'express';
import type { GraphQLError } from 'graphql';

import {
  resolveErrorCode,
  resolveMessage,
  resolveStatus,
} from '@/common/utils/error';
import {
  buildHttpRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  resolveUserId,
  setResponseTimeHeader,
} from '@/common/utils/request-context';
import {
  formatValidationError,
  isValidationErrorLike,
} from '@/common/utils/validation';
import { GraphQLExceptionFilter } from '@/global/filters/graphql-exception.filter';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { LogContext } from '@/global/types/log.type';
import { ApiResponseTemplate } from '@/global/types/response';

/** NestJS 글로벌 필터는 host type별로 1회만 매칭되므로 컨텍스트별 분기(HTTP 자체 처리 / GraphQL은 GraphQLExceptionFilter 위임)를 본 필터에서 수행한다. */
@Catch()
export class HttpExceptionFilter extends BaseExceptionFilter {
  constructor(
    httpAdapter: AbstractHttpAdapter,
    private readonly logger: CustomLoggerService,
    private readonly gqlFilter: GraphQLExceptionFilter,
  ) {
    super(httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): GraphQLError | void {
    if (host.getType<GqlContextType>() === 'graphql') {
      return this.gqlFilter.format(exception, host);
    }

    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { requestId, startTime } = ensureRequestTracking(req, res);
    const userId = resolveUserId(req);
    const request = buildHttpRequestMeta(req, { defaultVersion: '1' });

    const status = resolveStatus(exception);
    const message = resolveMessage(exception);
    const errorCode = resolveErrorCode(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const duration = calculateDuration(startTime);

    this.logger.txError({
      userId,
      requestId,
      request,
      error: { statusCode: status, message, stack },
      processingTimeInMs: duration,
      context: LogContext.REST,
    });

    setResponseTimeHeader(res, duration);

    if (exception instanceof BadRequestException) {
      const resp = exception.getResponse();
      const msgsUnknown =
        typeof resp === 'object' && resp && 'message' in resp
          ? (resp as Record<string, unknown>).message
          : undefined;
      const msgs = Array.isArray(msgsUnknown) ? msgsUnknown : [];
      const picked = msgs.filter(isValidationErrorLike);

      if (picked.length > 0) {
        const list = picked.map(formatValidationError);
        res
          .status(status)
          .json(
            ApiResponseTemplate.ERROR_WITH_DATA(
              list,
              message,
              status,
              errorCode,
            ),
          );
        return;
      }

      res
        .status(status)
        .json(ApiResponseTemplate.ERROR(message, status, errorCode));
      return;
    }

    res
      .status(status)
      .json(ApiResponseTemplate.ERROR(message, status, errorCode));
  }
}
