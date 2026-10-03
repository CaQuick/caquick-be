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

// graphql-js 변수 강제 변환 오류는 원래 값을 그대로 싣는다(예: 현재 위치 좌표) — 로그에는 값만 가리고 경로·사유는 남긴다
const INVALID_VARIABLE_VALUE =
  /^(Variable "\$[^"]+" got invalid value )([\s\S]*?)((?: at "[^"]*")?(?:; [^;]*)?)$/;

export function redactVariableValue(message: string): string {
  return message.replace(INVALID_VARIABLE_VALUE, '$1[redacted]$3');
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

  const original = `${String(formatted.extensions?.code)}: ${redactVariableValue(formatted.message)}`;
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
