import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { OrderStatus } from '@/generated/prisma/client';

@Injectable()
export class OrderStatusTransitionPolicy {
  parse(raw: string): OrderStatus {
    if (raw === 'SUBMITTED') return OrderStatus.SUBMITTED;
    if (raw === 'CONFIRMED') return OrderStatus.CONFIRMED;
    if (raw === 'MADE') return OrderStatus.MADE;
    if (raw === 'PICKED_UP') return OrderStatus.PICKED_UP;
    if (raw === 'CANCELED') return OrderStatus.CANCELED;
    throw new DomainException('INVALID_ORDER_STATUS');
  }

  assertSellerTransition(from: OrderStatus, to: OrderStatus): void {
    if (from === to) {
      throw new DomainException('ORDER_STATUS_UNCHANGED');
    }

    // SUBMITTED는 주문 생성 시점의 초기 상태이므로 어떤 상태에서도 되돌아갈 수 없다.
    if (to === OrderStatus.SUBMITTED) {
      throw new DomainException('INVALID_ORDER_STATUS_TRANSITION');
    }

    if (to === OrderStatus.CONFIRMED && from !== OrderStatus.SUBMITTED) {
      throw new DomainException('INVALID_ORDER_STATUS_TRANSITION');
    }

    if (to === OrderStatus.MADE && from !== OrderStatus.CONFIRMED) {
      throw new DomainException('INVALID_ORDER_STATUS_TRANSITION');
    }

    if (to === OrderStatus.PICKED_UP && from !== OrderStatus.MADE) {
      throw new DomainException('INVALID_ORDER_STATUS_TRANSITION');
    }

    if (to === OrderStatus.CANCELED) {
      const cancellable =
        from === OrderStatus.SUBMITTED ||
        from === OrderStatus.CONFIRMED ||
        from === OrderStatus.MADE;
      if (!cancellable) {
        throw new DomainException('ORDER_NOT_CANCELLABLE');
      }
    }
  }

  requiresCancellationNote(to: OrderStatus): boolean {
    return to === OrderStatus.CANCELED;
  }
}
