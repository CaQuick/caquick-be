import type { AdminSellerRow } from '@/features/admin/repositories/admin.repository';
import { activeOrNull } from '@/features/admin/services/admin-mappers.helper';
import type { AdminSellerOutput } from '@/features/admin/types/admin-output.type';

/** nested relation은 soft-delete 자동 필터 밖이라 deleted_at을 직접 본다. */
export function toAdminSellerOutput(row: AdminSellerRow): AdminSellerOutput {
  const profile = activeOrNull(row.seller_profile);
  const store = activeOrNull(row.store);
  const credential = activeOrNull(row.credential);
  return {
    accountId: row.id.toString(),
    username: credential?.username ?? null,
    email: row.email,
    name: row.name,
    status: row.status,
    mustChangePassword: credential?.must_change_password ?? false,
    lastLoginAt: credential?.last_login_at ?? null,
    profile: profile
      ? {
          businessName: profile.business_name,
          businessPhone: profile.business_phone,
          websiteUrl: profile.website_url,
        }
      : null,
    store: store
      ? {
          id: store.id.toString(),
          storeName: store.store_name,
          storePhone: store.store_phone,
          addressFull: store.address_full,
          isActive: store.is_active,
        }
      : null,
    createdAt: row.created_at,
  };
}
