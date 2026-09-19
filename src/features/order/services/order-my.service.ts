import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { sliceOverfetched } from '@/common/utils/pagination';
import type { MyOrdersInput } from '@/features/order/dto/inputs/my-orders.input';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import {
  toOrderItemDetail,
  toOrderStatusHistory,
} from '@/features/order/services/order-output-mappers.helper';
import type {
  MyOrderConnection,
  MyOrderDetail,
} from '@/features/order/types/order-my-output.type';
import { formatBusinessHours } from '@/features/store';
import { OrderStatus } from '@/generated/prisma/client';

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

    const { items: sliced, hasMore } = sliceOverfetched(orders, limit);

    // N+1 회피: PICKED_UP + 미작성 리뷰가 있는 order id 집합을 단일 IN 쿼리로 조회
    const reviewableOrderIds =
      await this.orderRepository.findReviewableOrderIds({
        accountId,
        orderIds: sliced.map((o) => o.id),
      });

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
          hasReviewableItem: reviewableOrderIds.has(order.id.toString()),
        };
      }),
      totalCount,
      hasMore,
    };
  }

  async getMyOrder(accountId: bigint, orderId: bigint): Promise<MyOrderDetail> {
    const order = await this.orderRepository.findOrderDetailByAccount({
      orderId,
      accountId,
    });

    if (!order) {
      throw new DomainException('ORDER_NOT_FOUND');
    }

    const firstItem = order.items[0];
    const store = firstItem?.store;
    const isPickedUp = order.status === OrderStatus.PICKED_UP;

    return {
      orderId: order.id.toString(),
      orderNumber: order.order_number,
      status: order.status,
      createdAt: order.created_at,
      pickupAt: order.pickup_at,
      buyerName: order.buyer_name,
      buyerPhone: order.buyer_phone,
      subtotalPrice: order.subtotal_price,
      discountPrice: order.discount_price,
      totalPrice: order.total_price,
      submittedAt: order.submitted_at,
      confirmedAt: order.confirmed_at,
      madeAt: order.made_at,
      pickedUpAt: order.picked_up_at,
      canceledAt: order.canceled_at,
      statusHistories: order.status_histories.map(toOrderStatusHistory),
      items: order.items.map((item) => ({
        item: toOrderItemDetail(item),
        representativeImageUrl: item.product?.images?.[0]?.image_url ?? null,
        hasMyReview: Boolean(item.review && !item.review.deleted_at),
        canWriteReview:
          isPickedUp && (!item.review || Boolean(item.review.deleted_at)),
      })),
      store: store
        ? {
            storeId: store.id.toString(),
            storeName: store.store_name,
            storePhone: store.store_phone,
            addressFull: store.address_full,
            addressCity: store.address_city,
            addressDistrict: store.address_district,
            addressNeighborhood: store.address_neighborhood,
            latitude: store.latitude ? Number(store.latitude) : null,
            longitude: store.longitude ? Number(store.longitude) : null,
            businessHoursText: formatBusinessHours(
              store.business_hours,
              store.business_hours_text,
            ),
            websiteUrl: store.website_url,
          }
        : {
            storeId: '0',
            storeName: '매장 정보 없음',
            storePhone: '',
            addressFull: '',
            addressCity: null,
            addressDistrict: null,
            addressNeighborhood: null,
            latitude: null,
            longitude: null,
            businessHoursText: null,
            websiteUrl: null,
          },
    };
  }
}
