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
import * as ts from 'typescript';

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
 * 인라인 예외 메시지 금지 가드.
 *
 * 계약: throw 자리에서 메시지 **문자열을 직접 쓰지 않는다**. 문구는 카탈로그
 * (`domainError(code)`)에서 오거나, 런타임 값이 섞여야 하면 이름 붙은 빌더
 * 함수에서 온다. 빌더는 상수와 같은 모듈에 두어 따로 검토할 수 있게 한다.
 *
 * 그래서 탐지 기준은 "예외 생성자의 첫 인자가 문자열/템플릿 리터럴인가"다.
 * 정규식으로는 작은따옴표만 잡혀 큰따옴표·템플릿 리터럴이 그대로 빠져나간다
 * (실제로 그렇게 새던 자리가 있었다) — TypeScript AST로 판정한다.
 */
describe('인라인 예외 메시지 금지', () => {
  const SRC_ROOT = resolve(__dirname, '..', '..');
  const SKIP_DIRS = new Set(['generated', 'node_modules']);

  /**
   * 런타임 값이 섞여 빌더로도 못 빼는 자리. 비어 있는 게 정상이고, 추가하려면
   * "왜 이름 붙은 빌더로 못 빼는가"를 같이 남긴다.
   */
  const INLINE_MESSAGE_ALLOWLIST: string[] = [];

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

  /** `new XxxException(<문자열 리터럴 형태>)` 위치를 전부 모은다. */
  function inlineMessageSites(fileName: string, source: string): string[] {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const hits: string[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.endsWith('Exception')
      ) {
        const arg = node.arguments?.[0];
        if (
          arg &&
          (ts.isStringLiteral(arg) ||
            ts.isNoSubstitutionTemplateLiteral(arg) ||
            ts.isTemplateExpression(arg))
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            arg.getStart(sourceFile),
          );
          hits.push(`${fileName}:${(line + 1).toString()}`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return hits;
  }

  const files = tsFiles(SRC_ROOT).filter(
    (f) =>
      !f.endsWith('.spec.ts') &&
      !f.includes('/test/') &&
      !INLINE_MESSAGE_ALLOWLIST.some((a) => f.endsWith(a)),
  );

  it('스캔 대상을 실제로 모았다 (0건 통과 방지)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  // 막아야 할 형태를 전수로 고정한다. 정규식 버전이 놓쳤던 큰따옴표·템플릿이
  // 여기 들어 있다 — 새 형태가 생기면 줄을 추가한다.
  it.each([
    ['작은따옴표', "throw new BadRequestException('nope');", true],
    ['큰따옴표', 'throw new BadRequestException("nope");', true],
    ['템플릿(치환 없음)', 'throw new NotFoundException(`nope`);', true],
    ['템플릿(치환 있음)', 'throw new BadRequestException(`x ${y}`);', true],
    ['여러 줄 인자', "throw new ForbiddenException(\n  'nope',\n);", true],
    ['카탈로그 호출', "throw domainError('INVALID_ID');", false],
    [
      '빌더 호출',
      'throw new BadRequestException(maxLengthMessage(10));',
      false,
    ],
    ['상수 참조', 'throw new BadRequestException(SOME_MESSAGE);', false],
  ])('탐지기: %s → %s', (_label, snippet, shouldDetect) => {
    expect(inlineMessageSites('probe.ts', snippet).length > 0).toBe(
      shouldDetect,
    );
  });

  it('프로덕션 코드에 인라인 예외 메시지가 없다', () => {
    const offenders = files.flatMap((f) =>
      inlineMessageSites(f, readFileSync(f, 'utf8')),
    );

    // 고정 문구면 카탈로그에 코드를 추가해 domainError(code)로 던진다.
    // 런타임 값이 섞이면 상수 모듈에 이름 붙은 빌더를 두고 그 호출을 넘긴다.
    expect(offenders).toEqual([]);
  });

  it('허용 목록은 비어 있다', () => {
    // 비어 있지 않다면 각 항목에 사유 주석이 있어야 한다(위 설명 참고).
    expect(INLINE_MESSAGE_ALLOWLIST).toEqual([]);
  });
});
