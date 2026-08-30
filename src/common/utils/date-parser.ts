import { BadRequestException } from '@nestjs/common';

export function toDate(raw?: Date | string | null): Date | undefined {
  if (raw === undefined || raw === null) return undefined;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date value.');
  }
  return date;
}

/** 시간 부분을 버리고 UTC 자정으로 정규화(@db.Date 비교/저장용). */
export function utcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function toDateRequired(
  raw: Date | string | null | undefined,
  field: string,
): Date {
  const date = toDate(raw);
  if (!date) throw new BadRequestException(`${field} is required.`);
  return date;
}
