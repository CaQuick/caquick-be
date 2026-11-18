import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/**
 * 주문 접수 이벤트(판매자 '새 주문' 푸시 원천). 입금 확인 때 발행한다.
 * payload는 생산 시점 스냅샷 — 소비자가 order·store·product를 다시 읽지 않는다.
 */
export const ORDER_SUBMITTED = 'order.submitted';

export interface OrderSubmittedPayload {
  orderId: string;
  orderNumber: string;
  buyerAccountId: string;
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  quantity: number;
  /** ISO 8601 */
  pickupAt: string;
  totalPrice: number;
  /** ISO 8601. 확정 마감이 없던 옛 이벤트는 null */
  confirmDeadlineAt: string | null;
}

export function orderSubmittedEvent(args: {
  orderId: bigint;
  orderNumber: string;
  buyerAccountId: bigint;
  storeId: bigint;
  storeName: string;
  productId: bigint;
  productName: string;
  quantity: number;
  pickupAt: Date;
  totalPrice: number;
  confirmDeadlineAt: Date;
  occurredAt: Date;
  actorAccountId: bigint | null;
}): OutboxEventInput {
  const payload: OrderSubmittedPayload = {
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    buyerAccountId: args.buyerAccountId.toString(),
    storeId: args.storeId.toString(),
    storeName: args.storeName,
    productId: args.productId.toString(),
    productName: args.productName,
    quantity: args.quantity,
    pickupAt: args.pickupAt.toISOString(),
    totalPrice: args.totalPrice,
    confirmDeadlineAt: args.confirmDeadlineAt.toISOString(),
  };
  return {
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: ORDER_SUBMITTED,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: args.actorAccountId,
  };
}

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseOrderSubmittedPayload(
  value: Prisma.JsonValue,
): OrderSubmittedPayload {
  const p = value as Partial<Record<keyof OrderSubmittedPayload, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    typeof p.buyerAccountId !== 'string' ||
    typeof p.storeId !== 'string' ||
    typeof p.storeName !== 'string' ||
    typeof p.productId !== 'string' ||
    typeof p.productName !== 'string' ||
    !Number.isSafeInteger(p.quantity) ||
    typeof p.pickupAt !== 'string' ||
    Number.isNaN(Date.parse(p.pickupAt)) ||
    !Number.isSafeInteger(p.totalPrice)
  ) {
    throw new Error(`${ORDER_SUBMITTED} payload 형식 오류`);
  }
  return {
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    buyerAccountId: p.buyerAccountId,
    storeId: p.storeId,
    storeName: p.storeName,
    productId: p.productId,
    productName: p.productName,
    quantity: p.quantity as number,
    pickupAt: p.pickupAt,
    totalPrice: p.totalPrice as number,
    confirmDeadlineAt:
      typeof p.confirmDeadlineAt === 'string' &&
      !Number.isNaN(Date.parse(p.confirmDeadlineAt))
        ? p.confirmDeadlineAt
        : null,
  };
}
