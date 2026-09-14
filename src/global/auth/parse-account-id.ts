import { domainError } from '@/common/errors';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

export function parseAccountId(user: JwtUser): bigint {
  const raw =
    typeof user.accountId === 'string'
      ? user.accountId.trim()
      : String(user.accountId ?? '');
  if (raw === '') {
    throw domainError('INVALID_ACCOUNT_ID');
  }
  let id: bigint;
  try {
    id = BigInt(raw);
  } catch {
    throw domainError('INVALID_ACCOUNT_ID');
  }
  if (id < 0n) {
    throw domainError('INVALID_ACCOUNT_ID');
  }
  return id;
}
