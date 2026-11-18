import type { OutboxEventInput } from '@/features/outbox';
import {
  OrderActor,
  OrderCancelReason,
  OrderStatus,
  type Prisma,
} from '@/generated/prisma/client';

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
  /** 아래 넷은 취소 정책 도입 전 이벤트에 없다 — 파서가 null로 채운다 */
  actorType: OrderActor | null;
  cancelReason: OrderCancelReason | null;
  refundAmount: number | null;
  pickupAt: string | null;
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
  actorType: OrderActor;
  pickupAt: Date;
  cancelReason?: OrderCancelReason;
  refundAmount?: number;
  occurredAt: Date;
  actorAccountId: bigint | null;
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
    actorType: args.actorType,
    cancelReason: args.cancelReason ?? null,
    refundAmount: args.refundAmount ?? null,
    pickupAt: args.pickupAt.toISOString(),
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
const ORDER_ACTORS = new Set<string>(Object.values(OrderActor));
const CANCEL_REASONS = new Set<string>(Object.values(OrderCancelReason));

const malformed = (): Error =>
  new Error(`${ORDER_STATUS_CHANGED} payload 형식 오류`);

const isMember = (set: Set<string>) => (v: unknown) =>
  typeof v === 'string' && set.has(v);

/** 없으면(옛 이벤트) null, 있는데 형태가 어긋나면 던진다. */
function optional<T>(value: unknown, valid: (v: unknown) => boolean): T | null {
  if (value === undefined || value === null) return null;
  if (!valid(value)) throw malformed();
  return value as T;
}

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
    !isMember(ORDER_STATUSES)(p.fromStatus) ||
    !isMember(ORDER_STATUSES)(p.toStatus)
  ) {
    throw malformed();
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
    actorType: optional(p.actorType, isMember(ORDER_ACTORS)),
    cancelReason: optional(p.cancelReason, isMember(CANCEL_REASONS)),
    refundAmount: optional(p.refundAmount, Number.isSafeInteger),
    pickupAt: optional(
      p.pickupAt,
      (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)),
    ),
  };
}
