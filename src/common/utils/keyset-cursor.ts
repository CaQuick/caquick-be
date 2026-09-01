import { BadRequestException } from '@nestjs/common';

/**
 * "<timestampMs>:<id>" 형식 키셋 커서 파싱 공용 유틸.
 * 커서 토큰은 (시각, id) desc 정렬과 결합돼 있어 정렬이 바뀌면 무효다.
 *
 * 방어(전부 형식 오류로 거부):
 * - 형식 불일치, 안전 정수 밖 timestamp(자릿수 폭탄 → Infinity)
 * - Date 지원 범위(±8.64e15ms) 밖 timestamp → Invalid Date로 Prisma 내부 오류
 * - DB UNSIGNED BIGINT 상한을 넘는 id → 커넥터 범위 오류
 */

// DB UNSIGNED BIGINT 상한(2^64-1). 외부 입력 id의 범위 방어에 쓴다.
export const MAX_UNSIGNED_BIGINT = 18446744073709551615n;

export interface TimestampIdCursor {
  timestamp: Date;
  id: bigint;
}

export function parseTimestampIdCursor(
  raw: string,
  errorMessage: string,
): TimestampIdCursor {
  const match = /^(\d+):(\d+)$/.exec(raw);
  if (!match) {
    throw new BadRequestException(errorMessage);
  }
  const timestampMs = Number(match[1]);
  if (!Number.isSafeInteger(timestampMs)) {
    throw new BadRequestException(errorMessage);
  }
  const timestamp = new Date(timestampMs);
  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException(errorMessage);
  }
  const id = BigInt(match[2]);
  if (id > MAX_UNSIGNED_BIGINT) {
    throw new BadRequestException(errorMessage);
  }
  return { timestamp, id };
}

/** (시각, id) desc 페이지의 다음 커서 문자열. */
export function buildTimestampIdCursor(timestamp: Date, id: bigint): string {
  return `${timestamp.getTime()}:${id.toString()}`;
}

/**
 * 숫자 id 단독 커서 파싱. parseId와 달리 DB UNSIGNED BIGINT 상한까지
 * 검증한다 — 상한 초과 값이 커넥터 범위 오류로 번지는 것을 형식 오류로
 * 선제 거부한다.
 */
export function parseIdCursor(raw: string, errorMessage: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(errorMessage);
  }
  const id = BigInt(raw);
  if (id > MAX_UNSIGNED_BIGINT) {
    throw new BadRequestException(errorMessage);
  }
  return id;
}
