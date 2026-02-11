import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrderStatusPolicy {
  parse(raw: string): OrderStatus {
    if (raw === 'SUBMITTED') return OrderStatus.SUBMITTED;
    if (raw === 'CONFIRMED') return OrderStatus.CONFIRMED;
    if (raw === 'MADE') return OrderStatus.MADE;
    if (raw === 'PICKED_UP') return OrderStatus.PICKED_UP;
    if (raw === 'CANCELED') return OrderStatus.CANCELED;
    throw new BadRequestException('Invalid order status.');
  }

  assertSellerTransition(from: OrderStatus, to: OrderStatus): void {
    if (from === to) {
      throw new BadRequestException('Order status is already set to target.');
    }

    if (to === OrderStatus.CONFIRMED && from !== OrderStatus.SUBMITTED) {
      throw new BadRequestException('Invalid order status transition.');
    }

    if (to === OrderStatus.MADE && from !== OrderStatus.CONFIRMED) {
      throw new BadRequestException('Invalid order status transition.');
    }

    if (to === OrderStatus.PICKED_UP && from !== OrderStatus.MADE) {
      throw new BadRequestException('Invalid order status transition.');
    }

    if (to === OrderStatus.CANCELED) {
      const cancellable =
        from === OrderStatus.SUBMITTED ||
        from === OrderStatus.CONFIRMED ||
        from === OrderStatus.MADE;
      if (!cancellable) {
        throw new BadRequestException(
          'Order cannot be canceled from current status.',
        );
      }
    }
  }

  requiresCancellationNote(to: OrderStatus): boolean {
    return to === OrderStatus.CANCELED;
  }
}
