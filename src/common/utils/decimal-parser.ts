import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** 허용 구간(양끝 포함). 좌표처럼 컬럼·도메인 범위가 정해진 값에 쓴다. */
export interface DecimalRange {
  min: number;
  max: number;
}

export const LATITUDE_RANGE: DecimalRange = { min: -90, max: 90 };
export const LONGITUDE_RANGE: DecimalRange = { min: -180, max: 180 };

/**
 * 좌표 같은 Decimal 컬럼 입력을 파싱한다. 정밀도 손실을 피하려고 문자열로 받는 값용.
 * null/undefined/공백은 "값 없음"(null). 숫자로 읽히지 않거나, NaN·Infinity처럼 유한하지
 * 않거나(Prisma.Decimal은 받아들이지만 DB DECIMAL 컬럼이 거부해 500이 난다), range 밖이면
 * 호출부가 정한 메시지로 거절한다.
 */
export function parseDecimalOrNull(
  raw: string | null | undefined,
  errorMessage: string,
  range?: DecimalRange,
): Prisma.Decimal | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(trimmed);
  } catch {
    throw new BadRequestException(errorMessage);
  }
  if (!decimal.isFinite()) throw new BadRequestException(errorMessage);
  if (range && (decimal.lt(range.min) || decimal.gt(range.max))) {
    throw new BadRequestException(errorMessage);
  }
  return decimal;
}
