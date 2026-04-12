import { BadRequestException, Injectable } from '@nestjs/common';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { USER_ORDER_ERRORS } from '@/features/user/constants/user-order-error-messages';
import type { MyOrdersInput } from '@/features/user/types/user-order-input.type';
import type { MyOrderConnection } from '@/features/user/types/user-order-output.type';

const MAX_LIMIT = 50;

@Injectable()
export class UserOrderService {
  constructor(private readonly orderRepository: OrderRepository) {}

  async listMyOrders(
    accountId: bigint,
    input?: MyOrdersInput,
  ): Promise<MyOrderConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;
    const statuses = input?.statuses;

    if (offset < 0) {
      throw new BadRequestException(USER_ORDER_ERRORS.INVALID_OFFSET);
    }
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(USER_ORDER_ERRORS.INVALID_LIMIT);
    }

    const [orders, totalCount] = await Promise.all([
      this.orderRepository.findOrdersByAccount({
        accountId,
        statuses,
        offset,
        limit: limit + 1,
      }),
      this.orderRepository.countOrdersByAccount({
        accountId,
        statuses,
      }),
    ]);

    const hasMore = orders.length > limit;
    const sliced = hasMore ? orders.slice(0, limit) : orders;

    return {
      items: sliced.map((order) => {
        const firstItem = order.items[0];
        const firstImage = firstItem?.product?.images?.[0];
        const itemCount = order._count.items;

        return {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          status: order.status,
          createdAt: order.created_at,
          pickupAt: order.pickup_at,
          representativeProductName:
            firstItem?.product_name_snapshot ?? '상품 정보 없음',
          representativeProductImageUrl: firstImage?.image_url ?? null,
          additionalItemCount: Math.max(0, itemCount - 1),
          totalPrice: order.total_price,
          storeName: firstItem?.store?.store_name ?? '매장 정보 없음',
        };
      }),
      totalCount,
      hasMore,
    };
  }
}
