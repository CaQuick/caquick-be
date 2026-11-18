import {
  parseRefundEventPayload,
  type RefundEventArgs,
  refundEventInput,
  type RefundEventPayload,
} from '@/features/order/events/refund-requested.event';
import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 관리자 환불 송금 완료. 구매자 환불 완료 알림의 원천이다. */
export const REFUND_COMPLETED = 'refund.completed';

export function refundCompletedEvent(args: RefundEventArgs): OutboxEventInput {
  return refundEventInput(REFUND_COMPLETED, args);
}

export function parseRefundCompletedPayload(
  value: Prisma.JsonValue,
): RefundEventPayload {
  return parseRefundEventPayload(REFUND_COMPLETED, value);
}
