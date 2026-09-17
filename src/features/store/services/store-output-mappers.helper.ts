import type { StoreOutput } from '@/features/store/types/store-record-output.type';
import type { Store } from '@/generated/prisma/client';

export function toStoreOutput(row: Store): StoreOutput {
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
