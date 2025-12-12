import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * HTTP 예외 객체에서 상태 코드 추출
 */
export function resolveStatus(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * 에러 메시지 추출
 */
export function resolveMessage(exception: unknown): string {
  if (exception instanceof HttpException || exception instanceof Error) {
    return exception.message;
  }
  return 'Internal Server Error';
}
