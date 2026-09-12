import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 좌표 같은 Decimal 컬럼 입력을 파싱한다. 정밀도 손실을 피하려고 문자열로 받는 값용.
 * null/undefined/공백은 "값 없음"(null)이고, 숫자로 읽히지 않으면 호출부가 정한 메시지로 거절한다.
 */
export function parseDecimalOrNull(
  raw: string | null | undefined,
  errorMessage: string,
): Prisma.Decimal | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    return new Prisma.Decimal(trimmed);
  } catch {
    throw new BadRequestException(errorMessage);
  }
}
