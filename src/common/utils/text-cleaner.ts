import { BadRequestException } from '@nestjs/common';

export function cleanRequiredText(raw: string, maxLength: number): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException('Required text is empty.');
  }
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`Text exceeds ${maxLength} length.`);
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
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`Text exceeds ${maxLength} length.`);
  }
  return trimmed;
}
