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

// graphql-js 변수 강제 변환 오류는 받은 값(예: 현재 위치 좌표)을 이스케이프 없이 싣고, 값·키·사유가 뒤섞여 안전하게 가를 수 없다.
// 로그에는 변수명만 남긴다. FE는 값을 변수로만 보내 리터럴·파서 오류에는 좌표가 실리지 않는다.
const VARIABLE_ERROR =
  /^Variable "\$([A-Za-z_][0-9A-Za-z_]*)" got invalid value /;

export function redactVariableValue(message: string): string {
  const variable = VARIABLE_ERROR.exec(message);
  return variable
    ? `Variable "$${variable[1]}" got invalid value [redacted]`
    : message;
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
