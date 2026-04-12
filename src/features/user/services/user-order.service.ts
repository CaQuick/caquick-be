import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { formatBusinessHours } from '@/common/utils/business-hours-formatter';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { USER_ORDER_ERRORS } from '@/features/user/constants/user-order-error-messages';
import type { MyOrdersInput } from '@/features/user/types/user-order-input.type';
import type {
  MyOrderConnection,
  MyOrderDetail,
} from '@/features/user/types/user-order-output.type';

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

  async getMyOrder(accountId: bigint, orderId: bigint): Promise<MyOrderDetail> {
    const order = await this.orderRepository.findOrderDetailByAccount({
      orderId,
      accountId,
    });

    if (!order) {
      throw new NotFoundException(USER_ORDER_ERRORS.ORDER_NOT_FOUND);
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
      statusHistories: order.status_histories.map((h) => ({
        fromStatus: h.from_status,
        toStatus: h.to_status,
        changedAt: h.changed_at,
        note: h.note,
      })),
      items: order.items.map((item) => ({
        orderItemId: item.id.toString(),
        productId: item.product_id.toString(),
        productName: item.product_name_snapshot,
        representativeImageUrl: item.product?.images?.[0]?.image_url ?? null,
        quantity: item.quantity,
        regularPrice: item.regular_price_snapshot,
        salePrice: item.sale_price_snapshot,
        itemSubtotalPrice: item.item_subtotal_price,
        selectedOptions: item.option_items.map((oi) => ({
          groupName: oi.group_name_snapshot,
          optionTitle: oi.option_title_snapshot,
          priceDelta: oi.option_price_delta_snapshot,
        })),
        customTexts: item.custom_texts.map((ct) => ({
          tokenKey: ct.token_key_snapshot,
          defaultText: ct.default_text_snapshot,
          valueText: ct.value_text,
          sortOrder: ct.sort_order,
        })),
        customFreeEdits: item.free_edits.map((fe) => ({
          cropImageUrl: fe.crop_image_url,
          descriptionText: fe.description_text,
          sortOrder: fe.sort_order,
          attachmentImageUrls: fe.attachments.map((a) => a.image_url),
        })),
        hasMyReview: Boolean(item.review),
        canWriteReview: isPickedUp && !item.review,
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
