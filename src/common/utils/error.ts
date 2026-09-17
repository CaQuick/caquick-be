import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import { DomainException, type ErrorCode } from '@/common/errors/error-catalog';
import { isValidationErrorLike } from '@/common/utils/validation';

export function resolveStatus(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

export function resolveMessage(exception: unknown): string {
  if (exception instanceof HttpException || exception instanceof Error) {
    return exception.message;
  }
  return 'Internal Server Error';
}

/** Apollo 관례의 분류값. `extensions.classification`으로만 노출하고 코드 정본은 카탈로그다(D29). */
const STATUS_CLASSIFICATION: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_USER_INPUT',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
};

export function classifyStatus(status: number): string {
  return STATUS_CLASSIFICATION[status] ?? 'INTERNAL_SERVER_ERROR';
}

/** ValidationPipe exceptionFactory가 만든 BadRequestException({ message: ValidationError[] }) */
export function isValidationException(exception: unknown): boolean {
  if (!(exception instanceof BadRequestException)) return false;
  const resp = exception.getResponse();
  const msgs =
    typeof resp === 'object' && resp && 'message' in resp
      ? (resp as Record<string, unknown>).message
      : undefined;
  return Array.isArray(msgs) && msgs.some(isValidationErrorLike);
}

/**
 * 응답에 실을 에러 코드. 카탈로그 코드가 정본이고, 필터 밖에서 만들어지는 예외만 고정 코드로 뭉갠다:
 * ValidationPipe → VALIDATION_FAILED, 라우터의 미등록 경로 404 → ROUTE_NOT_FOUND, 나머지 → INTERNAL_ERROR.
 * (앱 코드의 Nest 예외 직접 생성은 ESLint no-restricted-syntax가 막는다)
 */
export function resolveErrorCode(exception: unknown): ErrorCode {
  if (exception instanceof DomainException) return exception.code;
  if (isValidationException(exception)) return 'VALIDATION_FAILED';
  if (exception instanceof NotFoundException) return 'ROUTE_NOT_FOUND';
  return 'INTERNAL_ERROR';
}
