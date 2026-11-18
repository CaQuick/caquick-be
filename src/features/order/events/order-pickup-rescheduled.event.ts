import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 판매자 픽업 일시 변경(구매자 알림 원천). payload는 생산 시점 스냅샷이다. */
export const ORDER_PICKUP_RESCHEDULED = 'order.pickup_rescheduled';

export interface OrderPickupRescheduledPayload {
  orderId: string;
  orderNumber: string;
  buyerAccountId: string;
  storeId: string | null;
  storeName: string | null;
  productId: string | null;
  productName: string | null;
  /** ISO 8601 */
  fromPickupAt: string;
  /** ISO 8601 */
  toPickupAt: string;
}

export function orderPickupRescheduledEvent(args: {
  orderId: bigint;
  orderNumber: string;
  buyerAccountId: bigint;
  storeId: bigint | null;
  storeName: string | null;
  productId: bigint | null;
  productName: string | null;
  fromPickupAt: Date;
  toPickupAt: Date;
  occurredAt: Date;
  actorAccountId: bigint;
}): OutboxEventInput {
  const payload: OrderPickupRescheduledPayload = {
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    buyerAccountId: args.buyerAccountId.toString(),
    storeId: args.storeId?.toString() ?? null,
    storeName: args.storeName,
    productId: args.productId?.toString() ?? null,
    productName: args.productName,
    fromPickupAt: args.fromPickupAt.toISOString(),
    toPickupAt: args.toPickupAt.toISOString(),
  };
  return {
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: ORDER_PICKUP_RESCHEDULED,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: args.actorAccountId,
  };
}

const isIsoString = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));
const stringOrNull = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseOrderPickupRescheduledPayload(
  value: Prisma.JsonValue,
): OrderPickupRescheduledPayload {
  const p = value as Partial<
    Record<keyof OrderPickupRescheduledPayload, unknown>
  >;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    typeof p.buyerAccountId !== 'string' ||
    !isIsoString(p.fromPickupAt) ||
    !isIsoString(p.toPickupAt)
  ) {
    throw new Error(`${ORDER_PICKUP_RESCHEDULED} payload 형식 오류`);
  }
  return {
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    buyerAccountId: p.buyerAccountId,
    storeId: stringOrNull(p.storeId),
    storeName: stringOrNull(p.storeName),
    productId: stringOrNull(p.productId),
    productName: stringOrNull(p.productName),
    fromPickupAt: p.fromPickupAt,
    toPickupAt: p.toPickupAt,
  };
}
