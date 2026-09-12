import type { AdminSellerRow } from '@/features/admin/repositories/admin.repository';
import type { AdminSellerOutput } from '@/features/admin/types/admin-output.type';

/** 순수 매퍼(DI 없음). nested relation은 soft-delete 자동 필터 밖이라 deleted_at을 직접 본다. */
export function toAdminSellerOutput(row: AdminSellerRow): AdminSellerOutput {
  const profile =
    row.seller_profile && row.seller_profile.deleted_at === null
      ? row.seller_profile
      : null;
  const store = row.store && row.store.deleted_at === null ? row.store : null;
  const credential =
    row.credential && row.credential.deleted_at === null
      ? row.credential
      : null;
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
