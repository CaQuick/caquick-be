import type { OutboxEventInput } from '@/features/outbox';
import { OrderStatus, type Prisma } from '@/generated/prisma/client';

/** 주문 상태 전이 이벤트. payload는 생산 시점 스냅샷(P1-9) — 소비자(notification)가 order·store·product를 다시 읽지 않는다. */
export const ORDER_STATUS_CHANGED = 'order.status_changed';

export interface OrderStatusChangedPayload {
  orderId: string;
  orderNumber: string;
  buyerAccountId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  storeId: string | null;
  storeName: string | null;
  productId: string | null;
  productName: string | null;
}

export function orderStatusChangedEvent(args: {
  orderId: bigint;
  orderNumber: string;
  buyerAccountId: bigint;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  storeId: bigint | null;
  storeName: string | null;
  productId: bigint | null;
  productName: string | null;
  occurredAt: Date;
  actorAccountId: bigint;
}): OutboxEventInput {
  const payload: OrderStatusChangedPayload = {
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    buyerAccountId: args.buyerAccountId.toString(),
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    storeId: args.storeId?.toString() ?? null,
    storeName: args.storeName,
    productId: args.productId?.toString() ?? null,
    productName: args.productName,
  };
  return {
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: ORDER_STATUS_CHANGED,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: args.actorAccountId,
  };
}

const ORDER_STATUSES = new Set<string>(Object.values(OrderStatus));

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseOrderStatusChangedPayload(
  value: Prisma.JsonValue,
): OrderStatusChangedPayload {
  const p = value as Partial<Record<keyof OrderStatusChangedPayload, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    typeof p.buyerAccountId !== 'string' ||
    typeof p.fromStatus !== 'string' ||
    !ORDER_STATUSES.has(p.fromStatus) ||
    typeof p.toStatus !== 'string' ||
    !ORDER_STATUSES.has(p.toStatus)
  ) {
    throw new Error(`${ORDER_STATUS_CHANGED} payload 형식 오류`);
  }
  return {
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    buyerAccountId: p.buyerAccountId,
    fromStatus: p.fromStatus as OrderStatus,
    toStatus: p.toStatus as OrderStatus,
    storeId: typeof p.storeId === 'string' ? p.storeId : null,
    storeName: typeof p.storeName === 'string' ? p.storeName : null,
    productId: typeof p.productId === 'string' ? p.productId : null,
    productName: typeof p.productName === 'string' ? p.productName : null,
  };
}
