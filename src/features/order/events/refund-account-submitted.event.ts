import {
  parseRefundEventPayload,
  type RefundEventArgs,
  refundEventInput,
  type RefundEventPayload,
} from '@/features/order/events/refund-requested.event';
import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 구매자 환불 계좌 입력(덮어쓰기 포함). 관리자 송금 대기 알림의 원천이다. */
export const REFUND_ACCOUNT_SUBMITTED = 'refund.account_submitted';

export function refundAccountSubmittedEvent(
  args: RefundEventArgs,
): OutboxEventInput {
  return refundEventInput(REFUND_ACCOUNT_SUBMITTED, args);
}

export function parseRefundAccountSubmittedPayload(
  value: Prisma.JsonValue,
): RefundEventPayload {
  return parseRefundEventPayload(REFUND_ACCOUNT_SUBMITTED, value);
}
