import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
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
 * 응답에 실을 에러 코드. 카탈로그 코드가 정본이고, 필터 밖에서 만들어지는 예외만 고정 코드로 뭉갠다.
 * 카탈로그로 아직 이관되지 않은 Nest 예외(07b·07c 전)는 분류값을 임시 코드로 쓴다.
 */
export function resolveErrorCode(exception: unknown): string {
  if (exception instanceof DomainException) return exception.code;
  if (isValidationException(exception)) return 'VALIDATION_FAILED';
  if (exception instanceof HttpException) {
    return classifyStatus(exception.getStatus());
  }
  return 'INTERNAL_ERROR';
}
