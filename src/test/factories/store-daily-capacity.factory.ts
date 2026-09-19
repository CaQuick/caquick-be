import type {
  PrismaClient,
  StoreDailyCapacity,
} from '@/generated/prisma/client';

export interface StoreDailyCapacityOverrides {
  store_id: bigint;
  capacity_date: Date;
  capacity: number;
  deleted_at?: Date | null;
  /** false면 catalog 설정만 만들고 order 복제본은 두지 않는다(복제 지연 재현). */
  replicate?: boolean;
}

/**
 * catalog의 일일 capacity 설정 + order 복제본(order_store_daily_limit)을 함께 만든다 —
 * 앱에서는 StoreDailyCapacityChanged 이벤트가 복제본을 채우지만 spec은 소비 없이 "복제 완료" 상태에서 시작한다.
 */
export async function createStoreDailyCapacity(
  prisma: PrismaClient,
  overrides: StoreDailyCapacityOverrides,
): Promise<StoreDailyCapacity> {
  const row = await prisma.storeDailyCapacity.create({
    data: {
      store_id: overrides.store_id,
      capacity_date: overrides.capacity_date,
      capacity: overrides.capacity,
      deleted_at: overrides.deleted_at ?? null,
    },
  });
  if (overrides.replicate !== false && !overrides.deleted_at) {
    await prisma.orderStoreDailyLimit.create({
      data: {
        store_id: row.store_id,
        booking_date: row.capacity_date,
        capacity: row.capacity,
        source_updated_at: row.updated_at,
      },
    });
  }
  return row;
}
