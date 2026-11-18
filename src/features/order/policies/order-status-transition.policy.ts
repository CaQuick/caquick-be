import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { OrderStatus } from '@/generated/prisma/client';

const ORDER_STATUS_VALUES: readonly string[] = Object.values(OrderStatus);

/** 판매자가 만들 수 있는 전이(to → 허용 from). 표에 없는 to는 거절한다 — 새 상태가 조용히 열리지 않게. */
const SELLER_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    CONFIRMED: [OrderStatus.SUBMITTED],
    MADE: [OrderStatus.CONFIRMED],
    PICKED_UP: [OrderStatus.MADE],
    CANCELED: [OrderStatus.SUBMITTED, OrderStatus.CONFIRMED, OrderStatus.MADE],
  };

@Injectable()
export class OrderStatusTransitionPolicy {
  parse(raw: string): OrderStatus {
    if (ORDER_STATUS_VALUES.includes(raw)) return raw as OrderStatus;
    throw new DomainException('INVALID_ORDER_STATUS');
  }

  assertSellerTransition(from: OrderStatus, to: OrderStatus): void {
    if (from === to) {
      throw new DomainException('ORDER_STATUS_UNCHANGED');
    }
    if (SELLER_TRANSITIONS[to]?.includes(from)) return;
    throw new DomainException(
      to === OrderStatus.CANCELED
        ? 'ORDER_NOT_CANCELLABLE'
        : 'INVALID_ORDER_STATUS_TRANSITION',
    );
  }

  requiresCancellationNote(to: OrderStatus): boolean {
    return to === OrderStatus.CANCELED;
  }
}
