/**
 * 사용자 도메인의 동적 에러 문구.
 *
 * 고정 문구는 전부 common/errors 카탈로그에 있다. 여기 남은 셋은 제약값이
 * user.constants의 상수라, 문구에 숫자를 그대로 박으면 상수를 바꿨을 때
 * 메시지만 거짓말이 된다 — 조립을 한 곳에 모아 단일 소스를 유지한다.
 */

import {
  MAX_NICKNAME_LENGTH,
  MAX_PAGINATION_LIMIT,
  MIN_NICKNAME_LENGTH,
  PHONE_FORMAT_EXAMPLE,
} from '@/features/user/constants/user.constants';

export function nicknameLengthMessage(): string {
  return `닉네임은 ${MIN_NICKNAME_LENGTH.toString()}~${MAX_NICKNAME_LENGTH.toString()}자여야 합니다.`;
}

export function phoneFormatMessage(): string {
  return `휴대폰 번호 형식이 올바르지 않습니다. (예: ${PHONE_FORMAT_EXAMPLE})`;
}

export function paginationLimitMessage(): string {
  return `limit은 1~${MAX_PAGINATION_LIMIT.toString()} 사이여야 합니다.`;
}
