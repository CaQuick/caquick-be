import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import {
  OrderCancelFault,
  OrderCancelReason,
  type OrderActor,
  type OrderStatus,
} from '@/generated/prisma/client';

/** SDL CancelRefundRuleType. */
export const CANCEL_REFUND_RULES = [
  'NO_REFUND',
  'FULL_REFUND',
  'BY_FAULT',
] as const;
export type CancelRefundRule = (typeof CANCEL_REFUND_RULES)[number];

/** 잠금 시점의 취소 판정 재료. 돈이 있는 주문은 결제가 확인된 주문뿐이라 paidAmount는 미확인이면 0이다. */
export interface OrderCancelState {
  status: OrderStatus;
  paidAmount: number;
}

export interface OrderCancelRequest {
  actor: OrderActor;
  reason: OrderCancelReason;
  fault?: OrderCancelFault | null;
  refundAmount?: number | null;
}

export interface OrderCancelDecision {
  reason: OrderCancelReason;
  fault: OrderCancelFault | null;
  refundAmount: number;
}

const SELLER_REASONS: readonly OrderCancelReason[] = [
  OrderCancelReason.DESIGN_NOT_FEASIBLE,
  OrderCancelReason.OUT_OF_MATERIALS,
  OrderCancelReason.SCHEDULE_UNAVAILABLE,
  OrderCancelReason.INAPPROPRIATE_REQUEST,
  OrderCancelReason.BUYER_REQUEST,
  OrderCancelReason.OTHER,
];

/** 주체 → 취소할 수 있는 상태 → 고를 수 있는 사유. 표에 없는 조합은 거절한다(기본 거절). */
const CANCEL_REASONS: Record<
  OrderActor,
  Partial<Record<OrderStatus, readonly OrderCancelReason[]>>
> = {
  BUYER: {
    PENDING_PAYMENT: [OrderCancelReason.BUYER_REQUEST],
    SUBMITTED: [OrderCancelReason.BUYER_REQUEST],
  },
  SELLER: {
    SUBMITTED: SELLER_REASONS,
    CONFIRMED: SELLER_REASONS,
    MADE: SELLER_REASONS,
  },
  ADMIN: {
    PENDING_PAYMENT: [
      ...SELLER_REASONS,
      OrderCancelReason.PAYMENT_NOT_RECEIVED,
    ],
    SUBMITTED: SELLER_REASONS,
    CONFIRMED: SELLER_REASONS,
    MADE: SELLER_REASONS,
  },
  SYSTEM: {
    PENDING_PAYMENT: [OrderCancelReason.PAYMENT_NOT_RECEIVED],
    SUBMITTED: [OrderCancelReason.CONFIRM_TIMEOUT],
  },
};

const REFUND_RULES: Partial<Record<OrderStatus, CancelRefundRule>> = {
  PENDING_PAYMENT: 'NO_REFUND',
  SUBMITTED: 'FULL_REFUND',
  CONFIRMED: 'BY_FAULT',
  MADE: 'BY_FAULT',
};

/** 주체별 사유와 상태 × 사정 × 환불액 판정. 저장은 OrderTransitionRepository.cancelLocked가 잠금 뒤 이 판정으로 한다. */
@Injectable()
export class OrderCancelPolicy {
  reasonsFor(
    actor: OrderActor,
    status: OrderStatus,
  ): readonly OrderCancelReason[] {
    return CANCEL_REASONS[actor][status] ?? [];
  }

  canCancel(actor: OrderActor, status: OrderStatus): boolean {
    return this.reasonsFor(actor, status).length > 0;
  }

  refundRule(status: OrderStatus): CancelRefundRule | null {
    return REFUND_RULES[status] ?? null;
  }

  /** fault·refundAmount는 사정 선택 상태에서만 쓰고 그 밖에는 무시한다. */
  decide(
    request: OrderCancelRequest,
    state: OrderCancelState,
  ): OrderCancelDecision {
    const reasons = this.reasonsFor(request.actor, state.status);
    if (reasons.length === 0) {
      throw new DomainException('ORDER_NOT_CANCELLABLE');
    }
    if (!reasons.includes(request.reason)) {
      throw new DomainException('CANCEL_REASON_NOT_ALLOWED');
    }
    const { reason } = request;
    const rule = this.refundRule(state.status);
    if (rule === 'NO_REFUND') return { reason, fault: null, refundAmount: 0 };
    if (rule === 'FULL_REFUND') {
      return { reason, fault: null, refundAmount: state.paidAmount };
    }
    const { fault, refundAmount } = request;
    if (!fault) throw new DomainException('CANCEL_FAULT_REQUIRED');
    if (fault === OrderCancelFault.SELLER) {
      return { reason, fault, refundAmount: state.paidAmount };
    }
    if (refundAmount === undefined || refundAmount === null) {
      throw new DomainException('REFUND_AMOUNT_REQUIRED');
    }
    if (
      !Number.isSafeInteger(refundAmount) ||
      refundAmount < 0 ||
      refundAmount > state.paidAmount
    ) {
      throw new DomainException('REFUND_AMOUNT_OUT_OF_RANGE', {
        max: state.paidAmount.toLocaleString('ko-KR'),
      });
    }
    return { reason, fault, refundAmount };
  }
}
