import { Prisma } from '@/generated/prisma/client';

/** 트랜잭션 안에서 capacity 행을 잠그고 점유를 재집계해 검사-삽입 race로 capacity가 초과되는 것을 막는다. */
export interface DailyCapacityGuard {
  storeId: bigint;
  dateOnlyUtc: Date;
  dayStartUtc: Date;
  dayEndUtc: Date;
}

/**
 * capacity는 order 소유 복제본(order_store_daily_limit)에서 읽는다 — catalog 행을 잠그지 않는다.
 * 복제본이 없거나 capacity가 비어 있으면(tombstone) 무제한: 설정 직후 복제 지연 구간에는 제한 없이 받는다.
 * forUpdate는 같은 매장·날짜의 동시 주문 생성·픽업 변경을 직렬화한다. excludeOrderId는 픽업을 옮기는 주문 자신의 점유를 뺀다.
 */
export async function isDailyCapacityExceeded(
  db: Prisma.TransactionClient,
  guard: DailyCapacityGuard,
  quantity: number,
  options: { forUpdate: boolean; excludeOrderId?: bigint },
): Promise<boolean> {
  const capacityRows = await db.$queryRaw<{ capacity: number }[]>(Prisma.sql`
    SELECT capacity
    FROM order_store_daily_limit
    WHERE store_id = ${guard.storeId}
      AND booking_date = ${guard.dateOnlyUtc}
      AND capacity IS NOT NULL
    ${options.forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
  const capacity = capacityRows[0]?.capacity;
  if (capacity === undefined) return false;

  const bookedRows = await db.$queryRaw<{ booked: bigint }[]>(Prisma.sql`
    SELECT CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS booked
    FROM order_item oi
    JOIN \`order\` o
      ON o.id = oi.order_id
      AND o.deleted_at IS NULL
      AND o.status <> 'CANCELED'
      AND o.pickup_at >= ${guard.dayStartUtc}
      AND o.pickup_at < ${guard.dayEndUtc}
      ${options.excludeOrderId !== undefined ? Prisma.sql`AND o.id <> ${options.excludeOrderId}` : Prisma.empty}
    WHERE oi.store_id = ${guard.storeId}
      AND oi.deleted_at IS NULL
  `);
  const booked = Number(bookedRows[0]?.booked ?? 0);
  return booked + quantity > capacity;
}
