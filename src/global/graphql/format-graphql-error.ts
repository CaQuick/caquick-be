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

// graphql-js 입력 오류 문구는 받은 값을 그대로 싣는다(예: 현재 위치 좌표) — 로그에는 값만 가리고 경로·형식 사유는 남긴다.
// 값이 들어가는 템플릿 전부: 변수 강제 변환, 스칼라·열거형 사유, 리터럴 검증, 실행 인자, coerceInputValue 기본 문구, 파서 토큰
const VALUE_REDACTIONS: readonly [RegExp, string][] = [
  [
    /^(Variable "\$[^"]+" got invalid value )[\s\S]*?((?: at "[^"]*")?(?:; [^;]*)?)$/,
    '$1[redacted]$2',
  ],
  [/(cannot represent[^:]*): [\s\S]*$/, '$1: [redacted]'],
  [/(, found )[\s\S]*$/, '$1[redacted]'],
  [/(has invalid value )[\s\S]*$/, '$1[redacted]'],
  [/Value "[\s\S]*" does not exist in /, 'Value [redacted] does not exist in '],
  [/^(Invalid value )[\s\S]*$/, '$1[redacted]'],
  // 변수 JSON의 키는 임의 문자열이라 모르는 필드 이름도 값처럼 다룬다(타입명·Did you mean 후보는 서버가 정한 이름)
  [/(Field ")[\s\S]*?(" is not defined by type )/g, '$1[redacted]$2'],
  [
    /(Unexpected (?:Name|Int|Float|String|BlockString)) "[\s\S]*"/,
    '$1 [redacted]',
  ],
];

export function redactInputValues(message: string): string {
  return VALUE_REDACTIONS.reduce(
    (redacted, [pattern, replacement]) =>
      redacted.replace(pattern, replacement),
    message,
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
