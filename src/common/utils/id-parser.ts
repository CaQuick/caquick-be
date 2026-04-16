import { BadRequestException } from '@nestjs/common';

export function parseId(raw: string): bigint {
  try {
    const trimmed = raw.trim();
    if (trimmed === '') {
      throw new Error('empty');
    }
    const id = BigInt(trimmed);
    if (id < 0n) {
      throw new Error('negative');
    }
    return id;
  } catch {
    throw new BadRequestException('Invalid id.');
  }
}
