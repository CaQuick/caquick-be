import { BadRequestException } from '@nestjs/common';

import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

export function parseAccountId(user: JwtUser): bigint {
  try {
    return BigInt(user.accountId);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}
