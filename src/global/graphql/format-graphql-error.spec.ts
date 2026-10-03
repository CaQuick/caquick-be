import { Logger } from '@nestjs/common';
import {
  buildSchema,
  GraphQLError,
  parse,
  validate,
  type GraphQLFormattedError,
  type OperationDefinitionNode,
} from 'graphql';
import { getVariableValues } from 'graphql/execution/values';

import {
  formatGraphqlError,
  redactInputValues,
} from '@/global/graphql/format-graphql-error';

const LOCATED = { locations: [{ line: 1, column: 3 }], path: ['x'] };

describe('formatGraphqlError', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  // 필터가 만든 오류는 classification을 가진다 — 500 DomainException 문구도 그대로
  it.each([
    ['STORE_NOT_FOUND', 'NOT_FOUND', 404, '매장을 찾을 수 없습니다.'],
    [
      'S3_PRESIGN_FAILED',
      'INTERNAL_SERVER_ERROR',
      500,
      '업로드 URL 생성에 실패했습니다.',
    ],
  ])(
    '필터가 만든 %s 오류는 그대로 둔다',
    (code, classification, statusCode, message) => {
      const formatted: GraphQLFormattedError = {
        message,
        ...LOCATED,
        extensions: { code, classification, statusCode, requestId: 'r-1' },
      };

      expect(formatGraphqlError(formatted, new GraphQLError(message))).toBe(
        formatted,
      );
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it.each([
    'BAD_USER_INPUT',
    'GRAPHQL_VALIDATION_FAILED',
    'GRAPHQL_PARSE_FAILED',
    'BAD_REQUEST',
    'OPERATION_RESOLUTION_FAILURE',
  ])(
    'Apollo %s는 VALIDATION_FAILED(400)로 바꾸고 원문은 warn 로그로 남긴다',
    (apolloCode) => {
      const raw =
        'Variable "$input" got invalid value 99999999999 at "input.sortOrder"; Int cannot represent non 32-bit signed integer value: 99999999999';

      const result = formatGraphqlError(
        { message: raw, ...LOCATED, extensions: { code: apolloCode } },
        new GraphQLError(raw),
      );

      expect(result).toEqual({
        message: '입력값이 올바르지 않습니다.',
        ...LOCATED,
        extensions: {
          code: 'VALIDATION_FAILED',
          classification: 'BAD_USER_INPUT',
          statusCode: 400,
        },
      });
      expect(warn).toHaveBeenCalledWith(
        `${apolloCode}: Variable "$input" got invalid value [redacted]`,
      );
      expect(error).not.toHaveBeenCalled();
    },
  );

  it.each(['PERSISTED_QUERY_NOT_FOUND', 'PERSISTED_QUERY_NOT_SUPPORTED'])(
    'APQ 프로토콜 신호(%s)는 클라이언트 복구에 쓰이므로 그대로 둔다',
    (apolloCode) => {
      const formatted = {
        message: 'PersistedQueryNotFound',
        extensions: { code: apolloCode },
      };

      expect(formatGraphqlError(formatted, new Error('x'))).toBe(formatted);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['code 없음', undefined],
    ['Apollo 기본값', 'INTERNAL_SERVER_ERROR'],
    ['알 수 없는 코드', 'SOMETHING_ELSE'],
  ])(
    '%s(%p)는 INTERNAL_ERROR(500)로 바꾸고 원문·stack은 error 로그로 남긴다',
    (_label, apolloCode) => {
      const original = new Error('Expected Iterable, but did not find one');

      const result = formatGraphqlError(
        {
          message: original.message,
          ...LOCATED,
          extensions: { code: apolloCode, stacktrace: ['at secret.ts:1'] },
        },
        original,
      );

      expect(result).toEqual({
        message: '서버 오류가 발생했습니다.',
        ...LOCATED,
        extensions: {
          code: 'INTERNAL_ERROR',
          classification: 'INTERNAL_SERVER_ERROR',
          statusCode: 500,
        },
      });
      expect(error).toHaveBeenCalledWith(
        `${String(apolloCode)}: ${original.message}`,
        original.stack,
      );
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('extensions가 없고 원본이 Error가 아니어도 INTERNAL_ERROR로 바꾼다', () => {
    const result = formatGraphqlError({ message: 'boom' }, 'boom');

    expect(result.extensions).toEqual({
      code: 'INTERNAL_ERROR',
      classification: 'INTERNAL_SERVER_ERROR',
      statusCode: 500,
    });
    expect(error).toHaveBeenCalledWith('undefined: boom', undefined);
  });
});

describe('redactInputValues', () => {
  const SENTINEL = /37\.?5665/;
  const schema = buildSchema(`
    enum Kind { HOME WORK }
    input Loc { latitude: Float!  longitude: Float! }
    type Query {
      at(v: Loc!): Boolean
      float(v: Float): Boolean
      int(v: Int): Boolean
      kind(v: Kind): Boolean
    }
  `);

  function variableMessage(
    type: string,
    field: string,
    value: unknown,
  ): string {
    const [operation] = parse(`query Q($v: ${type}) { ${field}(v: $v) }`)
      .definitions as OperationDefinitionNode[];
    const result = getVariableValues(
      schema,
      operation.variableDefinitions ?? [],
      { v: value },
    );
    if (!result.errors) throw new Error('강제 변환이 성공했다');
    return result.errors[0].message;
  }

  function literalMessage(query: string): string {
    const [error] = validate(schema, parse(query));
    if (!error) throw new Error('검증이 통과했다');
    return error.message;
  }

  function syntaxMessage(query: string): string {
    try {
      parse(query);
    } catch (error) {
      return (error as GraphQLError).message;
    }
    throw new Error('파싱이 성공했다');
  }

  // 변수 오류는 값·키(따옴표·세미콜론·가짜 사유를 심어도)·사유를 모두 버리고 변수명만 남긴다
  it.each([
    ['Float 자리에 문자열', () => variableMessage('Float', 'float', '37.5665')],
    [
      '모르는 필드 키',
      () =>
        variableMessage('Loc!', 'at', {
          latitude: 1,
          longitude: 1,
          '37.5665': 1,
        }),
    ],
    [
      '구분자를 심은 키',
      () =>
        variableMessage('Loc!', 'at', {
          latitude: 1,
          longitude: 1,
          'a; Field "b" is not defined by type "Loc". 37.5665': 1,
        }),
    ],
    ['필드 누락', () => variableMessage('Loc!', 'at', { latitude: 37.5665 })],
    ['열거형 값', () => variableMessage('Kind', 'kind', '37.5665')],
  ])('변수 오류(%s)는 변수명만 남긴다', (_label, make) => {
    const message = make();
    expect(message).toMatch(SENTINEL);

    expect(redactInputValues(message)).toBe(
      'Variable "$v" got invalid value [redacted]',
    );
  });

  it.each([
    [
      '리터럴 스칼라 사유',
      () => literalMessage('{ float(v: "37.5665") }'),
      'Float cannot represent non numeric value: [redacted]',
    ],
    [
      '리터럴 형식 불일치',
      () => literalMessage('{ at(v: 37.5665) }'),
      'Expected value of type "Loc!", found [redacted]',
    ],
    [
      '리터럴 정수 자리 소수',
      () => literalMessage('{ int(v: 37.5665) }'),
      'Int cannot represent non-integer value: [redacted]',
    ],
    [
      '파서 토큰',
      () => syntaxMessage('37.5665'),
      'Syntax Error: Unexpected Float [redacted].',
    ],
    [
      '실행 인자',
      () => 'Argument "v" has invalid value 37.5665.',
      'Argument "v" has invalid value [redacted]',
    ],
  ])('%s: 값만 가린다', (_label, make, expected) => {
    const message = make();
    expect(message).toMatch(SENTINEL);

    expect(redactInputValues(message)).toBe(expected);
  });

  it.each([
    'Cannot query field "x" on type "Query".',
    'Variable "$v" of required type "Loc!" was not provided.',
    'Unknown argument "radius" on field "Query.at".',
  ])('값이 없는 문구는 그대로 둔다: %s', (message) => {
    expect(redactInputValues(message)).toBe(message);
  });

  it('formatGraphqlError의 warn 로그에 좌표가 남지 않는다', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const message = variableMessage('Float', 'float', '126.978');

    formatGraphqlError(
      { message, extensions: { code: 'BAD_USER_INPUT' } },
      new GraphQLError(message),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/126\.978/);
    warn.mockRestore();
  });
});
