import { Logger } from '@nestjs/common';
import {
  buildSchema,
  coerceInputValue,
  GraphQLError,
  GraphQLFloat,
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
        `${apolloCode}: Variable "$input" got invalid value [redacted] at "input.sortOrder"; Int cannot represent non 32-bit signed integer value: [redacted]`,
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
    input Probe { f: Float  i: Int  s: String  b: Boolean  id: ID  e: Kind  loc: Loc }
    type Query {
      at(input: Loc!): Boolean
      probe(input: Probe!): Boolean
      float(v: Float): Boolean
      int(v: Int): Boolean
      string(v: String): Boolean
      bool(v: Boolean): Boolean
      id(v: ID): Boolean
      kind(v: Kind): Boolean
    }
  `);

  function variableMessage(query: string, input: unknown): string {
    const [operation] = parse(query).definitions as OperationDefinitionNode[];
    const result = getVariableValues(
      schema,
      operation.variableDefinitions ?? [],
      { input },
    );
    if (!result.errors) throw new Error('강제 변환이 성공했다');
    return result.errors[0].message;
  }
  const probe = (input: unknown) =>
    variableMessage('query Q($input: Probe!) { probe(input: $input) }', input);
  const at = (input: unknown) =>
    variableMessage('query Q($input: Loc!) { at(input: $input) }', input);

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

  function coerceMessage(value: unknown): string {
    try {
      coerceInputValue(value, GraphQLFloat);
    } catch (error) {
      return (error as GraphQLError).message;
    }
    throw new Error('강제 변환이 성공했다');
  }

  // graphql-js가 값을 싣는 입력 오류 템플릿 전수. 문구는 실제 graphql-js 호출로 만든다
  it.each([
    ['변수: Float에 문자열', () => probe({ f: '37.5665' })],
    ['변수: Float에 배열', () => probe({ f: [37.5665] })],
    ['변수: Float에 객체', () => probe({ f: { v: 37.5665 } })],
    ['변수: Int에 소수', () => probe({ i: 37.5665 })],
    ['변수: Int 32비트 초과', () => probe({ i: 3756650000000 })],
    ['변수: String에 숫자', () => probe({ s: 37.5665 })],
    ['변수: Boolean에 숫자', () => probe({ b: 37.5665 })],
    ['변수: ID에 객체', () => probe({ id: { lat: 37.5665 } })],
    ['변수: 열거형에 모르는 문자열', () => probe({ e: '37.5665' })],
    ['변수: 열거형에 숫자', () => probe({ e: 37.5665 })],
    [
      '변수: 모르는 필드',
      () => at({ latitude: 37.5665, longitude: 1, foo: 1 }),
    ],
    ['변수: 필드 누락', () => at({ latitude: 37.5665 })],
    ['변수: 객체가 아닌 값', () => at('37.5665,126.978')],
    ['변수: 값 안의 세미콜론', () => at({ latitude: 37.5665, note: 'a; b' })],
    [
      '변수: 숫자 모양 필드 이름',
      () => at({ latitude: 1, longitude: 1, '37.5665': 1 }),
    ],
    [
      '변수: 접미 문구를 심은 필드 이름',
      () =>
        at({
          latitude: 1,
          longitude: 1,
          'x" is not defined by type "Loc". sneaky37.5665': 1,
        }),
    ],
    [
      '변수: 따옴표를 심은 필드 이름',
      () =>
        at({
          latitude: 1,
          longitude: 1,
          'k" is not defined by type 37.5665': 1,
        }),
    ],
    [
      '리터럴: 모르는 필드 이름',
      () =>
        'Field "lat37.5665" is not defined by type "Loc". Did you mean "latitude"?',
    ],
    ['리터럴: Float에 문자열', () => literalMessage('{ float(v: "37.5665") }')],
    ['리터럴: Float에 배열', () => literalMessage('{ float(v: [37.5665]) }')],
    [
      '리터럴: Float에 객체',
      () => literalMessage('{ float(v: { a: 37.5665 }) }'),
    ],
    ['리터럴: Int에 소수', () => literalMessage('{ int(v: 37.5665) }')],
    [
      '리터럴: Int 32비트 초과',
      () => literalMessage('{ int(v: 3756650000000) }'),
    ],
    ['리터럴: String에 숫자', () => literalMessage('{ string(v: 37.5665) }')],
    ['리터럴: Boolean에 숫자', () => literalMessage('{ bool(v: 37.5665) }')],
    ['리터럴: ID에 소수', () => literalMessage('{ id(v: 37.5665) }')],
    ['리터럴: 열거형에 문자열', () => literalMessage('{ kind(v: "37.5665") }')],
    [
      '리터럴: 입력 객체 필드',
      () =>
        literalMessage('{ at(input: { latitude: "37.5665", longitude: 1 }) }'),
    ],
    ['파서: 이름 자리에 숫자', () => syntaxMessage('{ at 37.5665 }')],
    ['파서: 문서 첫 토큰', () => syntaxMessage('37.5665')],
    ['coerceInputValue 기본 문구', () => coerceMessage('37.5665')],
    ['실행 인자', () => 'Argument "v" has invalid value 37.5665.'],
  ])('%s: 값을 가린다', (_label, make) => {
    const message = make();
    expect(message).toMatch(SENTINEL);

    const redacted = redactInputValues(message);

    expect(redacted).not.toMatch(SENTINEL);
    expect(redacted).toContain('[redacted]');
  });

  it('열거형의 모르는 이름은 값으로 보고 가린다', () => {
    const message = literalMessage('{ kind(v: L375665) }');
    expect(message).toContain('L375665');

    expect(redactInputValues(message)).not.toContain('L375665');
  });

  it.each([
    [
      '변수 경로와 스칼라 사유',
      () => probe({ f: '37.5665' }),
      'Variable "$input" got invalid value [redacted] at "input.f"; Float cannot represent non numeric value: [redacted]',
    ],
    [
      '변수 모르는 필드',
      () => at({ latitude: 37.5665, longitude: 1, foo: 1 }),
      'Variable "$input" got invalid value [redacted]; Field "[redacted]" is not defined by type "Loc".',
    ],
    [
      '리터럴 스칼라 사유',
      () => literalMessage('{ float(v: "37.5665") }'),
      'Float cannot represent non numeric value: [redacted]',
    ],
    [
      '리터럴 형식 불일치',
      () => literalMessage('{ at(input: 37.5665) }'),
      'Expected value of type "Loc!", found [redacted]',
    ],
    [
      '모르는 필드 이름과 서버가 정한 후보',
      () =>
        'Field "lat37.5665" is not defined by type "Loc". Did you mean "latitude"?',
      'Field "[redacted]" is not defined by type "Loc". Did you mean "latitude"?',
    ],
  ])('%s: 경로·형식 사유는 남긴다', (_label, make, expected) => {
    expect(redactInputValues(make())).toBe(expected);
  });

  it.each([
    'Cannot query field "x" on type "Query".',
    'Variable "$input" of required type "Loc!" was not provided.',
    'Unknown argument "radius" on field "Query.at".',
  ])('값이 없는 문구는 그대로 둔다: %s', (message) => {
    expect(redactInputValues(message)).toBe(message);
  });

  it('formatGraphqlError의 warn 로그에 좌표가 남지 않는다', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const message = probe({ f: '126.978' });

    formatGraphqlError(
      { message, extensions: { code: 'BAD_USER_INPUT' } },
      new GraphQLError(message),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/126\.978/);
    warn.mockRestore();
  });
});

// 변수 강제 변환 사유 허용 목록 — graphql-js 16의 사유 템플릿마다, 값·JSON 키에 공격 문자열을 심은 실제 문구로 전수 확인한다
describe('redactInputValues — 변수 강제 변환 사유 허용 목록', () => {
  const schema = buildSchema(`
    input One @oneOf { a: Int  b: Int }
    input Loc { latitude: Float!  longitude: Float! }
    input Outer { loc: Loc  points: [Loc!] }
    enum Kind { HOME WORK }
    scalar When
    type Query {
      at(v: Loc!): Boolean
      outer(v: Outer): Boolean
      one(v: One): Boolean
      int(v: Int): Boolean
      string(v: String): Boolean
      bool(v: Boolean): Boolean
      id(v: ID): Boolean
      kind(v: Kind): Boolean
      when(v: When): Boolean
    }
  `);
  (
    schema.getType('When') as { parseValue: (value: unknown) => unknown }
  ).parseValue = (value) => {
    if (value === 'undef') return undefined;
    throw new TypeError(`bad ${String(value)}`);
  };

  function message(type: string, field: string, value: unknown): string {
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

  /** 값·키에 심는 공격 문자열 — 구분자(;)·따옴표·가짜 경로·가짜 사유를 섞는다. 모두 37.5665를 품는다. */
  const ATTACKS = [
    '37.5665',
    'a; 37.5665',
    'sneaky" is not defined by type "Loc". 37.5665',
    'z; Field "q" is not defined by type "Loc". 37.5665',
    'w" at "v.latitude"; Expected type "Loc". 37.5665',
    'p; Float cannot represent non numeric value: 37.5665',
  ];
  const HEAD = 'Variable "$v" got invalid value [redacted]';

  /** 공격 입력: 분류는 틀어질 수 있어도 출력은 허용된 모양뿐이고 좌표가 남지 않는다. */
  const ADVERSARIAL: [string, () => string][] = ATTACKS.flatMap(
    (attack): [string, () => string][] => [
      [
        `모르는 필드 키 ${JSON.stringify(attack)}`,
        () => message('Loc!', 'at', { latitude: 1, longitude: 1, [attack]: 1 }),
      ],
      [
        `중첩 경로 Float ${JSON.stringify(attack)}`,
        () =>
          message('Outer', 'outer', {
            loc: { latitude: attack, longitude: 1 },
          }),
      ],
      [
        `목록 경로 Float ${JSON.stringify(attack)}`,
        () =>
          message('Outer', 'outer', {
            points: [
              { latitude: 1, longitude: 1 },
              { latitude: attack, longitude: 1 },
            ],
          }),
      ],
      [
        `객체 자리 문자열 ${JSON.stringify(attack)}`,
        () => message('Loc!', 'at', attack),
      ],
      [`Int ${JSON.stringify(attack)}`, () => message('Int', 'int', attack)],
      [
        `ID ${JSON.stringify(attack)}`,
        () => message('ID', 'id', { k: attack }),
      ],
      [
        `열거형 ${JSON.stringify(attack)}`,
        () => message('Kind', 'kind', attack),
      ],
      [
        `커스텀 스칼라 ${JSON.stringify(attack)}`,
        () => message('When', 'when', attack),
      ],
    ],
  );
  const NAME = '[A-Za-z_][0-9A-Za-z_]*';
  const DYM = ` Did you mean (?:the enum value )?"${NAME}"(?:(?:, |, or | or )"${NAME}")*\\?`;
  const SAFE_OUTPUT = new RegExp(
    `^Variable "\\$v" got invalid value \\[redacted\\](?: at "${NAME}(?:\\.${NAME}|\\[\\d+\\])*")?; (?:` +
      [
        '\\[redacted\\]',
        `Expected non-nullable type "[\\[\\]!0-9A-Za-z_]+" not to be null\\.`,
        `Expected type "${NAME}" to be an object\\.`,
        `Field "${NAME}" of required type "[\\[\\]!0-9A-Za-z_]+" was not provided\\.`,
        `Field "\\[redacted\\]" is not defined by type "${NAME}"\\.(?:${DYM})?`,
        `Exactly one key must be specified for OneOf type "${NAME}"\\.`,
        `Field "${NAME}" must be non-null\\.`,
        `Expected type "${NAME}"\\.(?: \\[redacted\\])?`,
        '(?:Int|Float|String|Boolean|ID) cannot represent [a-z0-9 -]*value: \\[redacted\\]',
        `Enum "${NAME}" cannot represent (?:non-string|non-enum) value: \\[redacted\\]`,
        `Value "\\[redacted\\]" does not exist in "${NAME}" enum\\.(?:${DYM})?`,
      ].join('|') +
      ')$',
  );

  const PLAIN = '37.5665';
  const CASES: [string, () => string, string][] = [
    [
      `모르는 필드 키 `,
      () => message('Loc!', 'at', { latitude: 1, longitude: 1, [PLAIN]: 1 }),
      `${HEAD}; Field "[redacted]" is not defined by type "Loc".`,
    ],
    [
      `중첩 경로의 Float 값 `,
      () =>
        message('Outer', 'outer', {
          loc: { latitude: PLAIN, longitude: 1 },
        }),
      `${HEAD} at "v.loc.latitude"; Float cannot represent non numeric value: [redacted]`,
    ],
    [
      `목록 경로의 Float 값 `,
      () =>
        message('Outer', 'outer', {
          points: [
            { latitude: 1, longitude: 1 },
            { latitude: PLAIN, longitude: 1 },
          ],
        }),
      `${HEAD} at "v.points[1].latitude"; Float cannot represent non numeric value: [redacted]`,
    ],
    [
      `객체 자리의 문자열 `,
      () => message('Loc!', 'at', PLAIN),
      `${HEAD}; Expected type "Loc" to be an object.`,
    ],
    [
      `Int 값 `,
      () => message('Int', 'int', PLAIN),
      `${HEAD}; Int cannot represent non-integer value: [redacted]`,
    ],
    [
      `ID 값 `,
      () => message('ID', 'id', { k: PLAIN }),
      `${HEAD}; ID cannot represent value: [redacted]`,
    ],
    [
      `열거형 값 `,
      () => message('Kind', 'kind', PLAIN),
      `${HEAD}; Value "[redacted]" does not exist in "Kind" enum.`,
    ],
    [
      `커스텀 스칼라 사유 `,
      () => message('When', 'when', PLAIN),
      `${HEAD}; Expected type "When". [redacted]`,
    ],
    [
      '필드 누락',
      () => message('Loc!', 'at', { latitude: 37.5665 }),
      `${HEAD}; Field "longitude" of required type "Float!" was not provided.`,
    ],
    [
      '목록 안의 null',
      () => message('Outer', 'outer', { points: [null] }),
      `${HEAD} at "v.points[0]"; Expected non-nullable type "Loc!" not to be null.`,
    ],
    [
      'Int 32비트 초과',
      () => message('Int', 'int', 3756650000000),
      `${HEAD}; Int cannot represent non 32-bit signed integer value: [redacted]`,
    ],
    [
      'String에 숫자',
      () => message('String', 'string', 37.5665),
      `${HEAD}; String cannot represent a non string value: [redacted]`,
    ],
    [
      'Boolean에 숫자',
      () => message('Boolean', 'bool', 37.5665),
      `${HEAD}; Boolean cannot represent a non boolean value: [redacted]`,
    ],
    [
      '열거형에 숫자',
      () => message('Kind', 'kind', 37.5665),
      `${HEAD}; Enum "Kind" cannot represent non-string value: [redacted]`,
    ],
    [
      '열거형 Did you mean 후보는 남긴다',
      () => message('Kind', 'kind', 'HOMEE37.5665'.slice(0, 5)),
      `${HEAD}; Value "[redacted]" does not exist in "Kind" enum. Did you mean the enum value "HOME"?`,
    ],
    [
      '필드 Did you mean 후보는 남긴다',
      () =>
        message('Loc!', 'at', { latitude: 1, longitude: 1, latitud: 37.5665 }),
      `${HEAD}; Field "[redacted]" is not defined by type "Loc". Did you mean "latitude"?`,
    ],
    [
      '커스텀 스칼라 사유 없음',
      () => message('When', 'when', 'undef'),
      `${HEAD}; Expected type "When".`,
    ],
    [
      'OneOf 키 개수',
      () => message('One', 'one', { a: 37, b: 5665 }),
      `${HEAD}; Exactly one key must be specified for OneOf type "One".`,
    ],
    [
      'OneOf null',
      () => message('One', 'one', { a: null }),
      `${HEAD} at "v.a"; Field "a" must be non-null.`,
    ],
    [
      '목록에 없는 사유는 통째로 가린다',
      () => 'Variable "$v" got invalid value 37.5665; Some new reason 37.5665',
      `${HEAD}; [redacted]`,
    ],
    [
      '너무 긴 문구는 맞추지 않고 사유째 가린다',
      () =>
        message('Loc!', 'at', {
          latitude: 'x'.repeat(2_100),
          longitude: 37.5665,
        }),
      `${HEAD}; [redacted]`,
    ],
  ];

  it.each(CASES)('%s', (_label, make, expected) => {
    const raw = make();
    const redacted = redactInputValues(raw);

    expect(redacted).toBe(expected);
    expect(redacted).not.toMatch(/37\.?5665|sneaky/);
  });

  it.each(ADVERSARIAL)('공격: %s', (_label, make) => {
    const raw = make();
    expect(raw).toMatch(/37\.?5665/);

    const redacted = redactInputValues(raw);

    expect(redacted).toMatch(SAFE_OUTPUT);
    expect(redacted).not.toMatch(/37\.?5665|sneaky/);
  });
});
