import { HttpException, HttpStatus } from '@nestjs/common';

import {
  DomainException,
  ERROR_CATALOG,
  errorStatus,
  renderErrorMessage,
  type ErrorCode,
} from '@/common/errors/error-catalog';

const CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];
const ALLOWED_STATUS = new Set<number>([
  HttpStatus.BAD_REQUEST,
  HttpStatus.UNAUTHORIZED,
  HttpStatus.FORBIDDEN,
  HttpStatus.NOT_FOUND,
  HttpStatus.CONFLICT,
  HttpStatus.INTERNAL_SERVER_ERROR,
]);

// 함수형 메시지의 렌더 파라미터 — 새 파라미터 코드를 추가하면 여기도 추가한다(전수 렌더 검사).
const RENDER_PARAMS: Partial<
  Record<ErrorCode, Record<string, string | number>>
> = {
  DATE_REQUIRED: { field: 'fromDate' },
  TEXT_TOO_LONG: { maxLength: 200 },
  INVALID_CONTENT_TYPE: { allowed: 'image/jpeg' },
  FILE_TOO_LARGE: { maxMb: 5 },
  NICKNAME_LENGTH_INVALID: { min: 2, max: 12 },
  INVALID_PHONE_FORMAT: { example: '010-1234-5678' },
  INVALID_LIMIT: { max: 50 },
};

// 필터 밖 경로(Apollo가 리졸버 진입 전에 만드는 에러)는 카탈로그 코드가 아니라 Apollo 자체 code를 낸다:
// GRAPHQL_PARSE_FAILED · GRAPHQL_VALIDATION_FAILED · BAD_USER_INPUT(변수 강제) · PERSISTED_QUERY_NOT_FOUND ·
// PERSISTED_QUERY_NOT_SUPPORTED · OPERATION_RESOLUTION_FAILURE. formatError로 덮지 않는다(D29).
describe('ERROR_CATALOG (전수)', () => {
  it.each(CODES)(
    '%s — status는 허용 집합, 메시지는 한국어 비공백 문자열로 렌더된다',
    (code) => {
      expect(ALLOWED_STATUS.has(errorStatus(code))).toBe(true);
      const message = renderErrorMessage(code, RENDER_PARAMS[code]);
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).toMatch(/[가-힣]/);
      expect(message).not.toMatch(/undefined|\$\{/);
    },
  );

  it('코드 이름은 SCREAMING_SNAKE_CASE다', () => {
    for (const code of CODES) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});

describe('DomainException', () => {
  it('코드로 status·메시지·응답 본문을 결정한다', () => {
    const e = new DomainException('STORE_NOT_FOUND');
    expect(e).toBeInstanceOf(HttpException);
    expect(e.code).toBe('STORE_NOT_FOUND');
    expect(e.getStatus()).toBe(404);
    expect(e.message).toBe('매장을 찾을 수 없습니다.');
    expect(e.getResponse()).toEqual({
      statusCode: 404,
      code: 'STORE_NOT_FOUND',
      message: '매장을 찾을 수 없습니다.',
    });
  });

  it('파라미터 메시지를 렌더한다', () => {
    expect(new DomainException('INVALID_LIMIT', { max: 50 }).message).toBe(
      'limit은 1~50 사이여야 합니다.',
    );
  });
});
