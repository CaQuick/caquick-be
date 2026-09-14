import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

/**
 * 메시지가 카탈로그 밖으로 "문자열"로 새어 나가면 그 경로의 오류에는 errorCode 가 실리지
 * 않는다. 실제로 그렇게 새던 곳이 4군데 있었다(decimal 파서, 커서 파서 2개, 신고 서비스) —
 * 헬퍼가 메시지를 인자로 받는 형태여서 호출부가 messageOf() 를 넘기고 있었다.
 *
 * 프로덕션 코드에서는 messageOf 를 쓰지 않는다(코드를 넘기고 domainError 가 메시지를 만든다).
 * 테스트 단언에서는 문구 비교가 필요하므로 spec 은 제외한다.
 */
describe('messageOf 사용 경계', () => {
  const SRC_ROOT = resolve(__dirname, '..', '..');
  const SKIP_DIRS = new Set(['generated', 'node_modules']);

  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...tsFiles(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  const productionFiles = tsFiles(SRC_ROOT).filter(
    (f) =>
      !f.endsWith('.spec.ts') &&
      !f.includes('/common/errors/') &&
      !f.includes('/test/'),
  );

  it('스캔 대상을 실제로 모았다 (0건 통과 방지)', () => {
    expect(productionFiles.length).toBeGreaterThan(100);
  });

  it('탐지기가 심어 둔 사용처를 잡는다 (반증 케이스)', () => {
    const planted = "const m = messageOf('STORE_NOT_FOUND');";
    expect(planted.includes('messageOf(')).toBe(true);
  });

  it('프로덕션 코드가 messageOf 를 쓰지 않는다', () => {
    const offenders = productionFiles.filter((f) =>
      readFileSync(f, 'utf8').includes('messageOf('),
    );

    // 메시지가 필요해 보이면 대개 헬퍼가 ErrorCode 를 받도록 바꾸는 게 맞다.
    expect(offenders).toEqual([]);
  });
});

/**
 * 예외 메시지를 코드 안에 문자열로 직접 쓰면 그 오류에는 errorCode 가 실리지 않고,
 * 문구가 여러 곳으로 흩어진다. 실제로 카탈로그 도입 뒤에도 인라인 throw 가 40곳
 * 남아 있었고, 그중에는 이관 대상 엔드포인트(POST /auth/refresh)도 있었다.
 *
 * 프로덕션 코드는 domainError(code) 로 던진다. 런타임 값이 들어가야 하는 문구만
 * 예외로 두고, 그 목록을 여기 고정한다 — 새로 늘면 이 테스트가 먼저 깨진다.
 */
describe('인라인 예외 메시지 금지', () => {
  const SRC_ROOT = resolve(__dirname, '..', '..');
  const SKIP_DIRS = new Set(['generated', 'node_modules']);

  /** 런타임 값이 들어가 카탈로그의 고정 문자열로 표현할 수 없는 자리 */
  const DYNAMIC_MESSAGE_ALLOWLIST = [
    'common/utils/text-cleaner.ts', // 최대 길이가 호출부마다 다르다
    'features/user/services/user-base.service.ts', // limit 상한
    'features/seller/constants/seller-error-messages.ts', // 필드명·범위
    'features/admin/constants/admin-error-messages.ts', // 발송 건수
  ];

  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...tsFiles(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  /** `new XxxException('...')` — 작은따옴표 리터럴 메시지 */
  const INLINE_MESSAGE = /new [A-Za-z]+Exception\(\s*'/;

  const files = tsFiles(SRC_ROOT).filter(
    (f) =>
      !f.endsWith('.spec.ts') &&
      !f.includes('/test/') &&
      !DYNAMIC_MESSAGE_ALLOWLIST.some((a) => f.endsWith(a)),
  );

  it('스캔 대상을 실제로 모았다 (0건 통과 방지)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('탐지기가 심어 둔 패턴을 잡는다 (반증 케이스)', () => {
    expect(INLINE_MESSAGE.test("throw new BadRequestException('nope');")).toBe(
      true,
    );
    // domainError 호출은 잡지 않아야 한다
    expect(INLINE_MESSAGE.test("throw domainError('INVALID_ID');")).toBe(false);
  });

  it('프로덕션 코드에 인라인 예외 메시지가 없다', () => {
    const offenders = files.filter((f) =>
      INLINE_MESSAGE.test(readFileSync(f, 'utf8')),
    );

    // 문구가 필요하면 카탈로그에 코드를 추가하고 domainError(code) 로 던진다.
    expect(offenders).toEqual([]);
  });

  it('허용 목록은 실제로 동적 문구를 쓰는 파일만 담는다', () => {
    // 허용해 놓고 정작 인라인 문구가 없다면 목록에서 빼야 한다(허용 범위 최소화).
    const stale = DYNAMIC_MESSAGE_ALLOWLIST.filter((a) => {
      const full = `${SRC_ROOT}/${a}`;
      return !/\$\{/.test(readFileSync(full, 'utf8'));
    });

    expect(stale).toEqual([]);
  });
});
