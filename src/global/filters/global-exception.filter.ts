import { ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { AbstractHttpAdapter, BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';

import { resolveMessage, resolveStatus } from 'src/common/helpers/error.helper';
import {
  buildHttpRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  resolveUserId,
  setResponseTimeHeader,
} from 'src/common/utils/request-context';
import {
  formatValidationError,
  isValidationErrorLike,
} from 'src/common/utils/validation';
import { CustomLoggerService } from 'src/global/logger/custom-logger.service';
import { LogContext } from 'src/global/types/log.type';
import { ApiResponseTemplate } from 'src/global/types/response';

/**
 * REST HTTP 요청에 대한 전역 예외 필터.
 * - GraphQL 컨텍스트는 여기에서 처리하지 않고, GraphQL 에러 핸들링에 맡긴다.
 */
@Catch()
export class HttpExceptionFilter extends BaseExceptionFilter {
  constructor(
    httpAdapter: AbstractHttpAdapter,
    private readonly logger: CustomLoggerService,
  ) {
    super(httpAdapter);
  }

  /**
   * 발생한 예외를 가로채어 구조화 로그를 기록하고, 표준 API 응답 포맷으로 변환한다.
   *
   * @param exception 발생한 예외 객체
   * @param host 실행 컨텍스트
   */
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { requestId, startTime } = ensureRequestTracking(req, res);
    const userId = resolveUserId(req);
    const request = buildHttpRequestMeta(req, { defaultVersion: '1' });

    const status = resolveStatus(exception);
    const message = resolveMessage(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const duration = calculateDuration(startTime);

    this.logger.error({
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
              'Validation Error',
              status,
            ),
          );
        return;
      }

      res.status(status).json(ApiResponseTemplate.ERROR(message, status));
      return;
    }

    res.status(status).json(ApiResponseTemplate.ERROR(message, status));
  }
}
