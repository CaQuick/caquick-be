import { activeOrNull } from '@/common/utils/active-or-null';
import type { SellerSelfRow } from '@/features/auth/repositories/account-admin.repository';
import type { SellerAccountOutput } from '@/features/auth/types/auth-seller-output.type';

/** nested relation은 soft-delete 자동 필터 밖이라 deleted_at을 직접 본다. */
export function toSellerAccountOutput(row: SellerSelfRow): SellerAccountOutput {
  const credential = activeOrNull(row.credential);
  return {
    accountId: row.id.toString(),
    username: credential?.username ?? null,
    displayName:
      row.name ?? activeOrNull(row.seller_profile)?.business_name ?? null,
    storeId: activeOrNull(row.store)?.id.toString() ?? null,
    mustChangePassword: credential?.must_change_password ?? false,
    accountStatus: row.status,
  };
}
