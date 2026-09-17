// 생성 클라이언트는 타입·Decimal 런타임만 쓰는 무의존 산출물이라 common에서 참조해도 레이어 규칙과 충돌하지 않는다.
import { DomainException } from '@/common/errors/error-catalog';
import { Prisma } from '@/generated/prisma/client';

export interface DecimalRange {
  min: number;
  max: number;
}

export const LATITUDE_RANGE: DecimalRange = { min: -90, max: 90 };
export const LONGITUDE_RANGE: DecimalRange = { min: -180, max: 180 };

/** Prisma.Decimal은 NaN·Infinity를 받아들이지만 DB DECIMAL 컬럼이 거부해 500이 나므로 유한값·range까지 여기서 거절한다. 정밀도 손실을 피하려고 문자열로 받는다. */
export function parseDecimalOrNull(
  raw: string | null | undefined,
  range?: DecimalRange,
): Prisma.Decimal | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(trimmed);
  } catch {
    throw new DomainException('INVALID_DECIMAL_VALUE');
  }
  if (!decimal.isFinite()) throw new DomainException('INVALID_DECIMAL_VALUE');
  if (range && (decimal.lt(range.min) || decimal.gt(range.max))) {
    throw new DomainException('INVALID_DECIMAL_VALUE');
  }
  return decimal;
}
