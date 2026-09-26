import { Injectable } from '@nestjs/common';

import type { IBookedQuantityQuery } from '@/common/ports/booked-quantity.port';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 예약된 제작 수량 집계(booked). catalog 픽업 판정이 포트로 읽는다 — CANCELED·soft-delete 주문은 제외. */
@Injectable()
export class OrderBookedRepository implements IBookedQuantityQuery {
  constructor(private readonly prisma: PrismaService) {}

  async sumByStore(
    storeIds: bigint[],
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<Map<bigint, number>> {
    if (storeIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { store_id: bigint; booked_quantity: bigint }[]
    >(Prisma.sql`
      SELECT oi.store_id AS store_id,
             CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS booked_quantity
      FROM order_item oi
      JOIN \`order\` o
        ON o.id = oi.order_id
        AND o.deleted_at IS NULL
        AND o.status <> 'CANCELED'
        AND o.pickup_at >= ${rangeStartUtc}
        AND o.pickup_at < ${rangeEndUtc}
      WHERE oi.store_id IN (${Prisma.join(storeIds)})
        AND oi.deleted_at IS NULL
      GROUP BY oi.store_id
    `);
    return new Map(rows.map((r) => [r.store_id, Number(r.booked_quantity)]));
  }

  /** KST는 DST 없는 고정 +9h라 INTERVAL 9 HOUR 변환으로 달력일을 묶는다. */
  async sumByKstDate(
    storeId: bigint,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      { pickup_date: string; booked_quantity: bigint }[]
    >(Prisma.sql`
      SELECT DATE_FORMAT(DATE_ADD(o.pickup_at, INTERVAL 9 HOUR), '%Y-%m-%d') AS pickup_date,
             CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS booked_quantity
      FROM order_item oi
      JOIN \`order\` o
        ON o.id = oi.order_id
        AND o.deleted_at IS NULL
        AND o.status <> 'CANCELED'
        AND o.pickup_at >= ${rangeStartUtc}
        AND o.pickup_at < ${rangeEndUtc}
      WHERE oi.store_id = ${storeId}
        AND oi.deleted_at IS NULL
      GROUP BY pickup_date
    `);
    return new Map(rows.map((r) => [r.pickup_date, Number(r.booked_quantity)]));
  }
}
