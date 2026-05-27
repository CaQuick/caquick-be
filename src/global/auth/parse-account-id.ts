import { BadRequestException } from '@nestjs/common';

import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

export function parseAccountId(user: JwtUser): bigint {
  const raw =
    typeof user.accountId === 'string'
      ? user.accountId.trim()
      : String(user.accountId ?? '');
  if (raw === '') {
    throw new BadRequestException('Invalid account id.');
  }
  let id: bigint;
  try {
    id = BigInt(raw);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
  if (id < 0n) {
    throw new BadRequestException('Invalid account id.');
  }
  return id;
}
