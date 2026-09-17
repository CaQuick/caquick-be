import type { AdminStoreDetailRow } from '@/features/admin/repositories/admin.repository';
import type {
  AdminStoreDetailOutput,
  AdminStoreOutput,
} from '@/features/admin/types/admin-output.type';
import type { Store } from '@/generated/prisma/client';

/** 순수 매퍼(DI 없음). */
export function toAdminStoreOutput(row: Store): AdminStoreOutput {
  return {
    id: row.id.toString(),
    sellerAccountId: row.seller_account_id.toString(),
    storeName: row.store_name,
    storePhone: row.store_phone,
    addressFull: row.address_full,
    addressCity: row.address_city,
    addressDistrict: row.address_district,
    addressNeighborhood: row.address_neighborhood,
    regionId: row.region_id?.toString() ?? null,
    latitude: row.latitude?.toString() ?? null,
    longitude: row.longitude?.toString() ?? null,
    mapProvider: row.map_provider,
    websiteUrl: row.website_url,
    businessHoursText: row.business_hours_text,
    profileImageUrl: row.profile_image_url,
    greetingMessage: row.greeting_message,
    pickupSlotIntervalMinutes: row.pickup_slot_interval_minutes,
    minLeadTimeMinutes: row.min_lead_time_minutes,
    maxDaysAhead: row.max_days_ahead,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAdminStoreDetailOutput(
  row: AdminStoreDetailRow,
): AdminStoreDetailOutput {
  const { seller_account, _count, ...store } = row;
  // nested 자격증명은 soft-delete 자동 필터 밖 — 삭제된 것은 없는 것으로 본다
  const credential =
    seller_account.credential && seller_account.credential.deleted_at === null
      ? seller_account.credential
      : null;
  return {
    store: toAdminStoreOutput(store),
    seller: {
      accountId: seller_account.id.toString(),
      username: credential?.username ?? null,
      email: seller_account.email,
      name: seller_account.name,
      status: seller_account.status,
    },
    productCount: _count.products,
    orderItemCount: _count.order_items,
  };
}
