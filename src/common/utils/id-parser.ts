import { BadRequestException } from '@nestjs/common';

import { MAX_UNSIGNED_BIGINT } from '@/common/utils/keyset-cursor';

export function parseId(raw: string): bigint {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new BadRequestException('Invalid id.');
  }
  let id: bigint;
  try {
    id = BigInt(trimmed);
  } catch {
    throw new BadRequestException('Invalid id.');
  }
  // DB UNSIGNED BIGINT 범위 밖 값은 커넥터 범위 오류(내부 오류)로 번진다 —
  // 클라이언트 입력 단계에서 형식 오류로 거부한다.
  if (id < 0n || id > MAX_UNSIGNED_BIGINT) {
    throw new BadRequestException('Invalid id.');
  }
  return id;
}

/**
 * nullable ID 입력용. null/undefined는 "값 없음"(null)이고, 그 외(빈 문자열 포함)는 parseId를
 * 그대로 태운다 — `"0"`·빈 문자열을 truthy 검사로 버리면 빈 ID가 "연결 해제"로 둔갑한다.
 */
export function parseOptionalId(raw: string | null | undefined): bigint | null {
  if (raw === undefined || raw === null) return null;
  return parseId(raw);
}
