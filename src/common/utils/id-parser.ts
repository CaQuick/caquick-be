import { BadRequestException } from '@nestjs/common';

export function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException('Invalid id.');
  }
}
