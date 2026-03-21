import { BadRequestException } from '@nestjs/common';

export function toDate(raw?: Date | string | null): Date | undefined {
  if (raw === undefined || raw === null) return undefined;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date value.');
  }
  return date;
}

export function toDateRequired(raw: Date | string, field: string): Date {
  const date = toDate(raw);
  if (!date) throw new BadRequestException(`${field} is required.`);
  return date;
}
