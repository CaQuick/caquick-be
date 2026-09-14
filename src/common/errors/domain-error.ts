import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ERROR_CATALOG,
  type ErrorCode,
  type ErrorDefinition,
} from '@/common/errors/error-catalog';

/** HttpException 응답 본문에 실리는 도메인 코드 키. 필터가 이 키로 코드를 꺼낸다. */
export const ERROR_CODE_KEY = 'errorCode';

/**
 * status → NestJS 예외 생성자. switch 대신 표로 두는 이유는, 카탈로그가 `satisfies`로
 * status 를 리터럴 유니온으로 추론해 switch 가 "아직 안 쓰는 status 분기는 도달 불가"라고
 * 판정하기 때문이다. 표는 그 좁히기에 걸리지 않고, 새 status 를 한 줄로 늘릴 수 있다.
 */
const EXCEPTION_BY_STATUS: Partial<
  Record<HttpStatus, (body: object) => HttpException>
> = {
  [HttpStatus.BAD_REQUEST]: (body) => new BadRequestException(body),
  [HttpStatus.UNAUTHORIZED]: (body) => new UnauthorizedException(body),
  [HttpStatus.FORBIDDEN]: (body) => new ForbiddenException(body),
  [HttpStatus.NOT_FOUND]: (body) => new NotFoundException(body),
  [HttpStatus.CONFLICT]: (body) => new ConflictException(body),
};

/**
 * 카탈로그 코드로 예외를 만든다.
 *
 * NestJS 예외 클래스를 그대로 쓰는 이유: 기존 필터·인터셉터·테스트가 status 와
 * 클래스(instanceof NotFoundException 등)에 의존한다. 새 예외 타입을 도입하면
 * 그 계약이 전부 깨진다. 여기서는 **응답 본문에 errorCode 를 얹기만** 한다.
 */
export function domainError(code: ErrorCode): HttpException {
  const { status, message }: ErrorDefinition = ERROR_CATALOG[code];
  const body = { message, [ERROR_CODE_KEY]: code, statusCode: status };

  const build = EXCEPTION_BY_STATUS[status];
  return build ? build(body) : new InternalServerErrorException(body);
}

/**
 * 예외에서 도메인 코드를 꺼낸다. 카탈로그를 거치지 않은 예외(class-validator 등)는 null.
 */
export function errorCodeOf(exception: unknown): ErrorCode | null {
  if (!(exception instanceof HttpException)) return null;

  const response: unknown = exception.getResponse();
  if (typeof response !== 'object' || response === null) return null;

  const code: unknown = (response as Record<string, unknown>)[ERROR_CODE_KEY];
  if (typeof code !== 'string') return null;

  return code in ERROR_CATALOG ? (code as ErrorCode) : null;
}
