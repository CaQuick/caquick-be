import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 확정 마감 2시간 전 판매자 미리 알림. payload는 생산 시점 스냅샷이다. */
export const ORDER_CONFIRM_REMINDER_DUE = 'order.confirm_reminder_due';

export interface OrderConfirmReminderDuePayload {
  orderId: string;
  orderNumber: string;
  storeId: string;
  productName: string;
  /** ISO 8601 */
  confirmDeadlineAt: string;
}

export function orderConfirmReminderDueEvent(args: {
  orderId: bigint;
  orderNumber: string;
  storeId: bigint;
  productName: string;
  confirmDeadlineAt: Date;
  occurredAt: Date;
}): OutboxEventInput {
  const payload: OrderConfirmReminderDuePayload = {
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    storeId: args.storeId.toString(),
    productName: args.productName,
    confirmDeadlineAt: args.confirmDeadlineAt.toISOString(),
  };
  return {
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: ORDER_CONFIRM_REMINDER_DUE,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: null,
  };
}

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseOrderConfirmReminderDuePayload(
  value: Prisma.JsonValue,
): OrderConfirmReminderDuePayload {
  const p = value as Partial<
    Record<keyof OrderConfirmReminderDuePayload, unknown>
  >;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    typeof p.storeId !== 'string' ||
    typeof p.productName !== 'string' ||
    typeof p.confirmDeadlineAt !== 'string' ||
    Number.isNaN(Date.parse(p.confirmDeadlineAt))
  ) {
    throw new Error(`${ORDER_CONFIRM_REMINDER_DUE} payload 형식 오류`);
  }
  return {
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    storeId: p.storeId,
    productName: p.productName,
    confirmDeadlineAt: p.confirmDeadlineAt,
  };
}
