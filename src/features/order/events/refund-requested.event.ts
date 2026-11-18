import type { OutboxEventInput } from '@/features/outbox';
import { RefundKind, type Prisma } from '@/generated/prisma/client';

/** 환불 생성(취소 환불·입금 반환). 구매자에게 돌려받을 계좌 입력을 요청하는 알림의 원천이다. */
export const REFUND_REQUESTED = 'refund.requested';

export interface RefundRequestedPayload {
  refundId: string;
  orderId: string;
  orderNumber: string;
  buyerAccountId: string;
  kind: RefundKind;
  amount: number;
  storeId: string | null;
  storeName: string | null;
  productId: string | null;
  productName: string | null;
}

export function refundRequestedEvent(args: {
  refundId: bigint;
  orderId: bigint;
  orderNumber: string;
  buyerAccountId: bigint;
  kind: RefundKind;
  amount: number;
  storeId: bigint | null;
  storeName: string | null;
  productId: bigint | null;
  productName: string | null;
  occurredAt: Date;
  actorAccountId: bigint | null;
}): OutboxEventInput {
  const payload: RefundRequestedPayload = {
    refundId: args.refundId.toString(),
    orderId: args.orderId.toString(),
    orderNumber: args.orderNumber,
    buyerAccountId: args.buyerAccountId.toString(),
    kind: args.kind,
    amount: args.amount,
    storeId: args.storeId?.toString() ?? null,
    storeName: args.storeName,
    productId: args.productId?.toString() ?? null,
    productName: args.productName,
  };
  return {
    // 같은 주문의 상태 전이와 같은 파티션 순서를 탄다
    aggregateType: 'order',
    aggregateId: payload.orderId,
    eventType: REFUND_REQUESTED,
    payload: { ...payload },
    occurredAt: args.occurredAt,
    actorAccountId: args.actorAccountId,
  };
}

const REFUND_KINDS = new Set<string>(Object.values(RefundKind));
const nullableString = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

export function parseRefundRequestedPayload(
  value: Prisma.JsonValue,
): RefundRequestedPayload {
  const p = value as Partial<Record<keyof RefundRequestedPayload, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.refundId !== 'string' ||
    typeof p.orderId !== 'string' ||
    typeof p.orderNumber !== 'string' ||
    typeof p.buyerAccountId !== 'string' ||
    typeof p.kind !== 'string' ||
    !REFUND_KINDS.has(p.kind) ||
    !Number.isSafeInteger(p.amount)
  ) {
    throw new Error(`${REFUND_REQUESTED} payload 형식 오류`);
  }
  return {
    refundId: p.refundId,
    orderId: p.orderId,
    orderNumber: p.orderNumber,
    buyerAccountId: p.buyerAccountId,
    kind: p.kind as RefundKind,
    amount: p.amount as number,
    storeId: nullableString(p.storeId),
    storeName: nullableString(p.storeName),
    productId: nullableString(p.productId),
    productName: nullableString(p.productName),
  };
}
