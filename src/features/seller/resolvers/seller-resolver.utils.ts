import { BadRequestException } from '@nestjs/common';

import type { JwtUser } from '../../../global/auth';

export function parseAccountId(user: JwtUser): bigint {
  try {
    return BigInt(user.accountId);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}

export function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException('Invalid id.');
  }
}
