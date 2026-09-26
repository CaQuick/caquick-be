import { DomainException } from '@/common/errors/error-catalog';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';
export function parseAccountId(user: JwtUser): bigint {
  const raw =
    typeof user.accountId === 'string'
      ? user.accountId.trim()
      : String(user.accountId ?? '');
  if (raw === '') {
    throw new DomainException('INVALID_ACCOUNT_ID');
  }
  let id: bigint;
  try {
    id = BigInt(raw);
  } catch {
    throw new DomainException('INVALID_ACCOUNT_ID');
  }
  if (id < 0n) {
    throw new DomainException('INVALID_ACCOUNT_ID');
  }
  return id;
}
