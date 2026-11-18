import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 구매자 '입금했어요'(관리자 경보 원천). 누른 주문은 미입금 자동 취소에서 빠져 관리자가 확인해야 끝난다. */
export const PAYMENT_DEPOSIT_CLAIMED = 'payment.deposit_claimed';

export interface PaymentDepositClaimedPayload {
  orderId: string;
  orderNumber: string;
  amount: number;
  depositorName: string;
}

export function paymentDepositClaimedEvent(args: {
  orderId: bigint;
  orderNumber: string;
  buyerAccountId: bigint;
  amount: number;
  depositorName: string;
  occurredAt: Date;
}): OutboxEventInput {
  const payload: PaymentDepositClaimedPayload = {
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    amount: args.amount,
    depositorName: args.depositorName,
  };
  return {
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: PAYMENT_DEPOSIT_CLAIMED,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: args.buyerAccountId,
  };
}

export function parsePaymentDepositClaimedPayload(
  value: Prisma.JsonValue,
): PaymentDepositClaimedPayload {
  const p = value as Partial<
    Record<keyof PaymentDepositClaimedPayload, unknown>
  >;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    !Number.isSafeInteger(p.amount) ||
    typeof p.depositorName !== 'string'
  ) {
    throw new Error(`${PAYMENT_DEPOSIT_CLAIMED} payload 형식 오류`);
  }
  return {
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    amount: p.amount as number,
    depositorName: p.depositorName,
  };
}
