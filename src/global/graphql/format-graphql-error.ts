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

/**
 * Nest 필터를 거치지 않는 Apollo 자체 오류를 필터 응답과 같은 모양(code·classification·statusCode)으로 맞춘다.
 * 필터가 만든 오류는 classification이 있어 그대로 둔다. 원문은 영문·스키마 구조라 로그에만 남긴다.
 */
export function formatGraphqlError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  if (formatted.extensions?.classification) return formatted;

  const original = `${String(formatted.extensions?.code)}: ${formatted.message}`;
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
