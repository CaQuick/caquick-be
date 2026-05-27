import { BadRequestException } from '@nestjs/common';

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
  if (id < 0n) {
    throw new BadRequestException('Invalid id.');
  }
  return id;
}
