import { BadRequestException } from '@nestjs/common';

import { domainError } from '@/common/errors';

/**
 * 길이는 코드 포인트 수로 센다 — class-validator MaxLength·MySQL utf8mb4 VARCHAR(n)과 같은 기준.
 * UTF-16 단위(String.length)로 세면 이모지 같은 보조 평면 문자가 2로 잡혀 DTO를 통과한 입력을 거절한다.
 */
function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

export function cleanRequiredText(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw domainError('REQUIRED_TEXT_EMPTY');
  }
  if (codePointLength(trimmed) > maxLength) {
    throw new BadRequestException(
      `입력은 ${maxLength.toString()}자를 넘을 수 없습니다.`,
    );
  }
  return trimmed;
}

export function cleanNullableText(
  raw: string | null | undefined,
  maxLength: number,
): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (codePointLength(trimmed) > maxLength) {
    throw new BadRequestException(
      `입력은 ${maxLength.toString()}자를 넘을 수 없습니다.`,
    );
  }
  return trimmed;
}
