import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import {
  domainError,
  ERROR_CATALOG,
  errorCodeOf,
  messageOf,
  type ErrorCode,
} from '@/common/errors';

const CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

describe('ERROR_CATALOG', () => {
  it('비어 있지 않다 (0건 통과 방지)', () => {
    expect(CODES.length).toBeGreaterThan(20);
  });

  it.each(CODES)('%s — 메시지가 한국어이고 비어 있지 않다', (code) => {
    const message = messageOf(code);
    expect(message.length).toBeGreaterThan(0);
    // 언어 통일(사용자 확정). 영어 문장이 섞이면 잡힌다.
    expect(message).toMatch(/[가-힣]/);
  });

  it('같은 메시지를 쓰는 코드가 없다 (중복 재발 방지)', () => {
    const byMessage = new Map<string, ErrorCode[]>();
    for (const code of CODES) {
      const list = byMessage.get(messageOf(code)) ?? [];
      list.push(code);
      byMessage.set(messageOf(code), list);
    }
    const duplicated = [...byMessage.entries()].filter(
      ([, codes]) => codes.length > 1,
    );
    expect(duplicated).toEqual([]);
  });
});

describe('domainError', () => {
  it.each([
    { status: HttpStatus.BAD_REQUEST, type: BadRequestException },
    { status: HttpStatus.FORBIDDEN, type: ForbiddenException },
    { status: HttpStatus.NOT_FOUND, type: NotFoundException },
    { status: HttpStatus.CONFLICT, type: ConflictException },
    {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      type: InternalServerErrorException,
    },
  ])('status $status → 대응 NestJS 예외', ({ status, type }) => {
    const code = CODES.find((c) => ERROR_CATALOG[c].status === status);
    // 카탈로그에 해당 status 코드가 있어야 이 매핑이 의미 있다
    expect(code).toBeDefined();
    expect(domainError(code!)).toBeInstanceOf(type);
  });

  it.each(CODES)('%s — status·message·errorCode 가 카탈로그와 일치', (code) => {
    const error = domainError(code);

    expect(error.getStatus()).toBe(ERROR_CATALOG[code].status);
    expect(error.message).toBe(messageOf(code));
    expect(errorCodeOf(error)).toBe(code);
  });
});

describe('errorCodeOf', () => {
  it.each([
    {
      label: '카탈로그를 거치지 않은 예외',
      value: new NotFoundException('직접 메시지'),
    },
    { label: '일반 Error', value: new Error('boom') },
    { label: '문자열', value: 'boom' },
    { label: 'null', value: null },
    {
      label: '응답 본문에 모르는 코드',
      value: new NotFoundException({ message: 'x', errorCode: 'NOT_A_CODE' }),
    },
    {
      label: 'errorCode 가 문자열이 아님',
      value: new NotFoundException({ message: 'x', errorCode: 42 }),
    },
  ])('$label 이면 null', ({ value }) => {
    expect(errorCodeOf(value)).toBeNull();
  });
});
