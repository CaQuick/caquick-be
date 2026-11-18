import { Injectable } from '@nestjs/common';

import { DomainException, type ErrorCode } from '@/common/errors/error-catalog';
import { DAY_MS } from '@/common/utils/kst-time';
import { OrderActor, OrderStatus } from '@/generated/prisma/client';

const ORDER_STATUS_VALUES: readonly string[] = Object.values(OrderStatus);

const { BUYER, SELLER, ADMIN, SYSTEM } = OrderActor;

/**
 * from → to → 그 전이를 할 수 있는 주체. 표에 없는 조합은 거절한다(기본 거절) — 새 상태가 조용히 열리지 않게.
 * 취소의 사유·사정·환불액은 OrderCancelPolicy가 따로 판정한다.
 */
const TRANSITIONS: Partial<
  Record<OrderStatus, Partial<Record<OrderStatus, readonly OrderActor[]>>>
> = {
  PENDING_PAYMENT: { SUBMITTED: [ADMIN], CANCELED: [BUYER, ADMIN, SYSTEM] },
  SUBMITTED: { CONFIRMED: [SELLER], CANCELED: [BUYER, SELLER, ADMIN, SYSTEM] },
  CONFIRMED: {
    MADE: [SELLER],
    PICKED_UP: [SELLER, ADMIN, SYSTEM],
    NO_SHOW: [SELLER],
    CANCELED: [SELLER, ADMIN],
  },
  MADE: {
    PICKED_UP: [SELLER, ADMIN, SYSTEM],
    NO_SHOW: [SELLER],
    CANCELED: [SELLER, ADMIN],
  },
};

/** 픽업 시각에서 이만큼 지나면 자동 픽업 완료되고, 노쇼는 그 전까지만 처리할 수 있다. */
export const AUTO_PICKUP_DELAY_MS = DAY_MS;

export interface OrderTransitionRequest {
  actor: OrderActor;
  from: OrderStatus;
  to: OrderStatus;
  now: Date;
  pickupAt: Date;
}

export function autoPickupAt(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() + AUTO_PICKUP_DELAY_MS);
}

/** 노쇼 처리 구간: 픽업 시각 ≤ now < 자동 픽업 완료 시각. */
export function isInNoShowWindow(pickupAt: Date, now: Date): boolean {
  return pickupAt <= now && now < autoPickupAt(pickupAt);
}

function violationOf({
  actor,
  from,
  to,
  now,
  pickupAt,
}: OrderTransitionRequest): ErrorCode | null {
  if (from === to) return 'ORDER_STATUS_UNCHANGED';
  if (!TRANSITIONS[from]?.[to]?.includes(actor)) {
    return 'INVALID_ORDER_STATUS_TRANSITION';
  }
  if (to === OrderStatus.NO_SHOW && !isInNoShowWindow(pickupAt, now)) {
    return 'NO_SHOW_NOT_ALLOWED';
  }
  if (
    to === OrderStatus.PICKED_UP &&
    actor === SYSTEM &&
    now < autoPickupAt(pickupAt)
  ) {
    return 'INVALID_ORDER_STATUS_TRANSITION';
  }
  return null;
}

@Injectable()
export class OrderStatusTransitionPolicy {
  parse(raw: string): OrderStatus {
    if (ORDER_STATUS_VALUES.includes(raw)) return raw as OrderStatus;
    throw new DomainException('INVALID_ORDER_STATUS');
  }

  /** 주체·상태·시각만 본다. 잠금 뒤 상태로 다시 부른다. */
  assertTransition(request: OrderTransitionRequest): void {
    const code = violationOf(request);
    if (code) throw new DomainException(code);
  }

  canTransition(request: OrderTransitionRequest): boolean {
    return violationOf(request) === null;
  }
}
