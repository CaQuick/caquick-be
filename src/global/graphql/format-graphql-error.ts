import { ApolloServerErrorCode } from '@apollo/server/errors';
import { Logger } from '@nestjs/common';
import type { GraphQLFormattedError } from 'graphql';

import { ERROR_CATALOG } from '@/common/errors/error-catalog';
import { classifyStatus } from '@/common/utils/error';

const logger = new Logger('GraphQL');

// 파싱·문서 검증·변수 강제 변환·요청 형식 오류 — 모두 클라이언트 입력 문제다
const CLIENT_ERROR_CODES = new Set<unknown>([
  ApolloServerErrorCode.BAD_USER_INPUT,
  ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED,
  ApolloServerErrorCode.GRAPHQL_PARSE_FAILED,
  ApolloServerErrorCode.BAD_REQUEST,
  ApolloServerErrorCode.OPERATION_RESOLUTION_FAILURE,
]);

// APQ 프로토콜 신호 — 클라이언트가 전체 쿼리 재전송·APQ 끄기로 복구하는 데 쓰므로 코드를 바꾸면 안 된다
const PROTOCOL_CODES = new Set<unknown>([
  ApolloServerErrorCode.PERSISTED_QUERY_NOT_FOUND,
  ApolloServerErrorCode.PERSISTED_QUERY_NOT_SUPPORTED,
]);

// graphql-js 입력 오류 문구는 받은 값을 그대로 싣는다(예: 현재 위치 좌표) — 로그에는 서버가 정한 부분만 남긴다.
const NAME = '[A-Za-z_][0-9A-Za-z_]*';
const TYPE_REF = '[\\[\\]!0-9A-Za-z_]+';
const PATH = `${NAME}(?:\\.${NAME}|\\[\\d+\\])*`;
const DID_YOU_MEAN = ` Did you mean (?:the enum value )?"${NAME}"(?:(?:, |, or | or )"${NAME}")*\\?`;
/** 변수 오류는 끝에서부터 맞춘다 — 이보다 길면 맞추지 않고 사유째 가린다(정규식 역추적 상한). */
const MAX_VARIABLE_ERROR_LENGTH = 2_000;

type Groups = Record<string, string | undefined>;

/**
 * 변수 강제 변환 오류(`Variable "$x" got invalid value <값>[ at "<경로>"]; <사유>`)의 사유 허용 목록 — graphql-js 16의
 * coerceInputValue·기본 스칼라·열거형이 만드는 문구 전부. 출력에는 캡처한 서버 이름(타입·필드·경로·후보)만 쓴다.
 * 값·JSON 키처럼 클라이언트가 정하는 부분은 [\s\S]*로 건너뛰어 버린다. 목록에 없는 사유는 통째로 가린다.
 * graphql-js는 값·키를 이스케이프하지 않아 공격 문자열은 분류를 틀어지게 할 수 있지만, 출력은 템플릿 상수·서버 이름 꼴 식별자·
 * [redacted]뿐이다. 값 구간은 greedy — 서버가 마지막에 붙인 실제 경로·사유를 고른다.
 */
const VARIABLE_REASONS: readonly [string, (g: Groups) => string][] = [
  [
    `Expected non-nullable type "(?<type>${TYPE_REF})" not to be null\\.`,
    (g) => `Expected non-nullable type "${g.type}" not to be null.`,
  ],
  [
    `Expected type "(?<type>${NAME})" to be an object\\.`,
    (g) => `Expected type "${g.type}" to be an object.`,
  ],
  [
    `Field "(?<field>${NAME})" of required type "(?<type>${TYPE_REF})" was not provided\\.`,
    (g) => `Field "${g.field}" of required type "${g.type}" was not provided.`,
  ],
  [
    `Field "[\\s\\S]*" is not defined by type "(?<type>${NAME})"\\.(?<dym>${DID_YOU_MEAN})?`,
    (g) =>
      `Field "[redacted]" is not defined by type "${g.type}".${g.dym ?? ''}`,
  ],
  [
    `Exactly one key must be specified for OneOf type "(?<type>${NAME})"\\.`,
    (g) => `Exactly one key must be specified for OneOf type "${g.type}".`,
  ],
  [
    `Field "(?<field>${NAME})" must be non-null\\.`,
    (g) => `Field "${g.field}" must be non-null.`,
  ],
  [`Expected type "(?<type>${NAME})"\\.`, (g) => `Expected type "${g.type}".`],
  [
    `Expected type "(?<type>${NAME})"\\. [\\s\\S]*`,
    (g) => `Expected type "${g.type}". [redacted]`,
  ],
  [
    `(?<scalar>(?:Int|Float|String|Boolean|ID) cannot represent [a-z0-9 -]*value): [\\s\\S]*`,
    (g) => `${g.scalar}: [redacted]`,
  ],
  [
    `Enum "(?<type>${NAME})" cannot represent (?<kind>non-string|non-enum) value: [\\s\\S]*`,
    (g) => `Enum "${g.type}" cannot represent ${g.kind} value: [redacted]`,
  ],
  [
    `Value "[\\s\\S]*" does not exist in "(?<type>${NAME})" enum\\.(?<dym>${DID_YOU_MEAN})?`,
    (g) =>
      `Value "[redacted]" does not exist in "${g.type}" enum.${g.dym ?? ''}`,
  ],
];

const VARIABLE_ERROR_HEAD = `Variable "\\$(?<variable>${NAME})" got invalid value `;
const VARIABLE_ERROR = new RegExp(`^${VARIABLE_ERROR_HEAD}`);
// 경로가 있는 꼴을 먼저 전부 맞춘다 — greedy 값 구간이 경로까지 삼키지 않게
const VARIABLE_REASON_PATTERNS = [` at "(?<path>${PATH})"; `, '; '].flatMap(
  (separator) =>
    VARIABLE_REASONS.map(
      ([reason, render]) =>
        [
          new RegExp(
            `^${VARIABLE_ERROR_HEAD}[\\s\\S]*${separator}(?:${reason})$`,
          ),
          render,
        ] as const,
    ),
);

function redactVariableError(message: string): string | null {
  const head = VARIABLE_ERROR.exec(message);
  if (!head) {
    return message.startsWith('Variable "$') &&
      message.includes(' got invalid value ')
      ? '[redacted]'
      : null;
  }
  const prefix = `Variable "$${head.groups?.variable}" got invalid value [redacted]`;
  if (message.length <= MAX_VARIABLE_ERROR_LENGTH) {
    for (const [pattern, render] of VARIABLE_REASON_PATTERNS) {
      const groups = pattern.exec(message)?.groups;
      if (!groups) continue;
      const path = groups.path ? ` at "${groups.path}"` : '';
      return `${prefix}${path}; ${render(groups)}`;
    }
  }
  return `${prefix}; [redacted]`;
}

// 변수 오류 밖의 값 템플릿: 스칼라·열거형 사유, 리터럴 검증, 실행 인자, coerceInputValue 기본 문구, 파서 토큰
const VALUE_REDACTIONS: readonly [RegExp, string][] = [
  [/(cannot represent[^:]*): [\s\S]*$/, '$1: [redacted]'],
  [/(, found )[\s\S]*$/, '$1[redacted]'],
  [/(has invalid value )[\s\S]*$/, '$1[redacted]'],
  [/Value "[\s\S]*" does not exist in /, 'Value [redacted] does not exist in '],
  [/^(Invalid value )[\s\S]*$/, '$1[redacted]'],
  [
    new RegExp(`(Field ")[\\s\\S]*(" is not defined by type "${NAME}"\\.)`),
    '$1[redacted]$2',
  ],
  [
    /(Unexpected (?:Name|Int|Float|String|BlockString)) "[\s\S]*"/,
    '$1 [redacted]',
  ],
];

export function redactInputValues(message: string): string {
  return (
    redactVariableError(message) ??
    VALUE_REDACTIONS.reduce(
      (redacted, [pattern, replacement]) =>
        redacted.replace(pattern, replacement),
      message,
    )
  );
}

/**
 * Nest 필터를 거치지 않는 Apollo 자체 오류를 필터 응답과 같은 모양(code·classification·statusCode)으로 맞춘다.
 * 필터가 만든 오류는 classification이 있어 그대로 둔다. 원문은 영문·스키마 구조라 로그에만 남긴다.
 */
export function formatGraphqlError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  if (formatted.extensions?.classification) return formatted;
  if (PROTOCOL_CODES.has(formatted.extensions?.code)) return formatted;

  const original = `${String(formatted.extensions?.code)}: ${redactInputValues(formatted.message)}`;
  const code = CLIENT_ERROR_CODES.has(formatted.extensions?.code)
    ? 'VALIDATION_FAILED'
    : 'INTERNAL_ERROR';
  if (code === 'VALIDATION_FAILED') {
    logger.warn(original);
  } else {
    logger.error(original, error instanceof Error ? error.stack : undefined);
  }

  const { status, message } = ERROR_CATALOG[code];
  return {
    ...formatted,
    message,
    extensions: {
      code,
      classification: classifyStatus(status),
      statusCode: status,
    },
  };
}
