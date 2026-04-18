import { BadRequestException } from '@nestjs/common';

import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

export function parseAccountId(user: JwtUser): bigint {
  try {
    const raw =
      typeof user.accountId === 'string'
        ? user.accountId.trim()
        : String(user.accountId ?? '');
    if (raw === '') {
      throw new Error('empty');
    }
    const id = BigInt(raw);
    if (id < 0n) {
      throw new Error('negative');
    }
    return id;
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}
