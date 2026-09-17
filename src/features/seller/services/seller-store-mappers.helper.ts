import type {
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';

/**
 * Store 분할 서비스들이 공유하는 매핑 헬퍼.
 *
 * 순수 함수 (this 의존 없음). DI 가 필요 없으므로 static export 만으로 충분.
 */

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
