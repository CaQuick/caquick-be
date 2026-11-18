import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 새 입금 대기 주문(관리자 경보 원천). 1시간 안에 확인해야 해서 '입금했어요'를 누르지 않은 주문도 알린다. */
export const ORDER_PAYMENT_PENDING = 'order.payment_pending';

export interface OrderPaymentPendingPayload {
  orderId: string;
  orderNumber: string;
  amount: number;
  depositorName: string;
  /** ISO 8601 */
  expiresAt: string;
}

export function orderPaymentPendingEvent(args: {
  orderId: bigint;
  orderNumber: string;
  buyerAccountId: bigint;
  amount: number;
  depositorName: string;
  expiresAt: Date;
  occurredAt: Date;
}): OutboxEventInput {
  const payload: OrderPaymentPendingPayload = {
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    amount: args.amount,
    depositorName: args.depositorName,
    expiresAt: args.expiresAt.toISOString(),
  };
  return {
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: ORDER_PAYMENT_PENDING,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: args.buyerAccountId,
  };
}

export function parseOrderPaymentPendingPayload(
  value: Prisma.JsonValue,
): OrderPaymentPendingPayload {
  const p = value as Partial<Record<keyof OrderPaymentPendingPayload, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    !Number.isSafeInteger(p.amount) ||
    typeof p.depositorName !== 'string' ||
    typeof p.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(p.expiresAt))
  ) {
    throw new Error(`${ORDER_PAYMENT_PENDING} payload 형식 오류`);
  }
  return {
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    amount: p.amount as number,
    depositorName: p.depositorName,
    expiresAt: p.expiresAt,
  };
}
