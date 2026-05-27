import { Prisma } from '@prisma/client';

import type {
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';

/**
 * Store 분할 서비스들이 공유하는 매핑 헬퍼.
 *
 * 순수 함수 (this 의존 없음). DI 가 필요 없으므로 static export 만으로 충분.
 */

export interface StoreRow {
  id: bigint;
  seller_account_id: bigint;
  store_name: string;
  store_phone: string;
  address_full: string;
  address_city: string | null;
  address_district: string | null;
  address_neighborhood: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  map_provider: 'NAVER' | 'KAKAO' | 'NONE';
  website_url: string | null;
  business_hours_text: string | null;
  pickup_slot_interval_minutes: number;
  min_lead_time_minutes: number;
  max_days_ahead: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StoreBusinessHourRow {
  id: bigint;
  day_of_week: number;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StoreSpecialClosureRow {
  id: bigint;
  closure_date: Date;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface StoreDailyCapacityRow {
  id: bigint;
  capacity_date: Date;
  capacity: number;
  created_at: Date;
  updated_at: Date;
}

export function toStoreOutput(row: StoreRow): SellerStoreOutput {
  return {
    id: row.id.toString(),
    sellerAccountId: row.seller_account_id.toString(),
    storeName: row.store_name,
    storePhone: row.store_phone,
    addressFull: row.address_full,
    addressCity: row.address_city,
    addressDistrict: row.address_district,
    addressNeighborhood: row.address_neighborhood,
    latitude: row.latitude?.toString() ?? null,
    longitude: row.longitude?.toString() ?? null,
    mapProvider: row.map_provider,
    websiteUrl: row.website_url,
    businessHoursText: row.business_hours_text,
    pickupSlotIntervalMinutes: row.pickup_slot_interval_minutes,
    minLeadTimeMinutes: row.min_lead_time_minutes,
    maxDaysAhead: row.max_days_ahead,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toStoreBusinessHourOutput(
  row: StoreBusinessHourRow,
): SellerStoreBusinessHourOutput {
  return {
    id: row.id.toString(),
    dayOfWeek: row.day_of_week,
    isClosed: row.is_closed,
    openTime: row.open_time,
    closeTime: row.close_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toStoreSpecialClosureOutput(
  row: StoreSpecialClosureRow,
): SellerStoreSpecialClosureOutput {
  return {
    id: row.id.toString(),
    closureDate: row.closure_date,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toStoreDailyCapacityOutput(
  row: StoreDailyCapacityRow,
): SellerStoreDailyCapacityOutput {
  return {
    id: row.id.toString(),
    capacityDate: row.capacity_date,
    capacity: row.capacity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
