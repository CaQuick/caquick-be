import { Logger } from '@nestjs/common';
import {
  buildSchema,
  GraphQLError,
  parse,
  type GraphQLFormattedError,
  type OperationDefinitionNode,
} from 'graphql';
import { getVariableValues } from 'graphql/execution/values';

import {
  formatGraphqlError,
  redactVariableValue,
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
        'Variable "$input" got invalid value 99999999999 at "input.sortOrder"';

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
        `${apolloCode}: Variable "$input" got invalid value [redacted] at "input.sortOrder"`,
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

describe('redactVariableValue', () => {
  const schema = buildSchema(`
    input LocationInput { latitude: Float!  longitude: Float! }
    type Query { at(input: LocationInput!): Boolean }
  `);
  const [operation] = parse(
    'query Q($input: LocationInput!) { at(input: $input) }',
  ).definitions as OperationDefinitionNode[];

  /** graphql-js가 실제로 만드는 변수 강제 변환 오류 문구. */
  function coercionMessage(input: unknown): string {
    const result = getVariableValues(
      schema,
      operation.variableDefinitions ?? [],
      { input },
    );
    if (!result.errors) throw new Error('강제 변환이 성공했다');
    return result.errors[0].message;
  }

  it.each([
    [
      '모르는 필드',
      { latitude: 37.5665, longitude: 126.978, foo: 1 },
      '; Field "foo" is not defined by type "LocationInput".',
    ],
    [
      '필드 누락',
      { latitude: 37.5665 },
      '; Field "longitude" of required type "Float!" was not provided.',
    ],
    [
      '객체가 아닌 값',
      '37.5665,126.978',
      '; Expected type "LocationInput" to be an object.',
    ],
    [
      '값 안의 세미콜론',
      { latitude: 37.5665, longitude: 126.978, note: 'a; b' },
      '; Field "note" is not defined by type "LocationInput".',
    ],
  ])('%s: 값은 가리고 사유는 남긴다', (_label, input, reason) => {
    const message = coercionMessage(input);
    expect(message).toContain('37.5665');

    expect(redactVariableValue(message)).toBe(
      `Variable "$input" got invalid value [redacted]${reason}`,
    );
  });

  it('잘못된 값의 경로는 남긴다', () => {
    const message = coercionMessage({ latitude: 37.5665, longitude: 'x' });

    expect(redactVariableValue(message)).toBe(
      'Variable "$input" got invalid value [redacted] at "input.longitude"; Float cannot represent non numeric value: "x"',
    );
  });

  it.each([
    'Cannot query field "x" on type "Query".',
    'Variable "$input" of required type "LocationInput!" was not provided.',
    'Syntax Error: Expected Name, found <EOF>.',
  ])('변수 값이 없는 문구는 그대로 둔다: %s', (message) => {
    expect(redactVariableValue(message)).toBe(message);
  });

  it('formatGraphqlError의 warn 로그에 좌표가 남지 않는다', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const message = coercionMessage({
      latitude: 37.5665,
      longitude: 126.978,
      foo: 1,
    });

    formatGraphqlError(
      { message, extensions: { code: 'BAD_USER_INPUT' } },
      new GraphQLError(message),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/37\.5665|126\.978/);
    warn.mockRestore();
  });
});
