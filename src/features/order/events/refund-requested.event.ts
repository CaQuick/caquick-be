import type { OutboxEventInput } from '@/features/outbox';
import { RefundKind, type Prisma } from '@/generated/prisma/client';

/**
 * 환불 생성(취소 환불·입금 반환). 계좌가 없으면 구매자 계좌 요청 알림, 취소와 함께 계좌가 들어왔으면
 * 관리자 송금 대기 알림의 원천이다.
 */
export const REFUND_REQUESTED = 'refund.requested';

/** 환불 이벤트(생성·계좌 입력·송금 완료) 공통 payload. 알림 행이 매장·상품 스냅샷을 그대로 싣는다. */
export interface RefundEventPayload {
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

export interface RefundEventArgs {
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
}

export interface RefundRequestedPayload extends RefundEventPayload {
  /** 생성과 함께 계좌가 들어왔는지. 이 필드가 없던 이벤트는 false다. */
  accountSubmitted: boolean;
}

export function refundEventInput(
  eventType: string,
  args: RefundEventArgs,
  extra: Record<string, boolean> = {},
): OutboxEventInput {
  const payload: RefundEventPayload = {
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
    eventType,
    payload: { ...payload, ...extra },
    occurredAt: args.occurredAt,
    actorAccountId: args.actorAccountId,
  };
}

const REFUND_KINDS = new Set<string>(Object.values(RefundKind));
const nullableString = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

export function parseRefundEventPayload(
  eventType: string,
  value: Prisma.JsonValue,
): RefundEventPayload {
  const p = value as Partial<Record<keyof RefundEventPayload, unknown>>;
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
    throw new Error(`${eventType} payload 형식 오류`);
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

export function refundRequestedEvent(
  args: RefundEventArgs & { accountSubmitted: boolean },
): OutboxEventInput {
  const { accountSubmitted, ...rest } = args;
  return refundEventInput(REFUND_REQUESTED, rest, { accountSubmitted });
}

export function parseRefundRequestedPayload(
  value: Prisma.JsonValue,
): RefundRequestedPayload {
  const base = parseRefundEventPayload(REFUND_REQUESTED, value);
  const { accountSubmitted } = value as { accountSubmitted?: unknown };
  return { ...base, accountSubmitted: accountSubmitted === true };
}
