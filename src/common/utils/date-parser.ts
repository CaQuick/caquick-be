import type { ErrorCode } from '@/common/errors';
import { domainError } from '@/common/errors';

export function toDate(raw?: Date | string | null): Date | undefined {
  if (raw === undefined || raw === null) return undefined;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw domainError('INVALID_DATE_VALUE');
  }
  return date;
}

/** 시간 부분을 버리고 UTC 자정으로 정규화(@db.Date 비교/저장용). */
export function utcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** 누락 시 던질 코드를 호출부가 정한다 — 필드명을 문구로 조립하면 카탈로그 밖으로 샌다. */
export function toDateRequired(
  raw: Date | string | null | undefined,
  missingCode: ErrorCode,
): Date {
  const date = toDate(raw);
  if (!date) throw domainError(missingCode);
  return date;
}
