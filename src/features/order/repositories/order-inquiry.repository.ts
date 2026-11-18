import { Injectable } from '@nestjs/common';

import { IN_PROGRESS_ORDER_STATUSES } from '@/features/order/constants/order-status-traits';
import { activeWhere, PrismaService } from '@/prisma';

export interface OrderCardSource {
  orderId: bigint;
  orderNumber: string;
  storeId: bigint;
  productName: string;
  thumbnailUrl: string | null;
  pickupAt: Date;
  /** 입금 확인(판매자 노출) 시각. null이면 판매자가 볼 수 없는 주문이다 */
  submittedAt: Date | null;
}

/** 채팅(conversation)이 묻는 구매자 주문 읽기. */
@Injectable()
export class OrderInquiryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 본인 주문의 카드 원천. 주문 1건 = 상품 1개라 첫 품목이 상품·매장을 대표한다. */
  async findOrderCardSource(args: {
    orderId: bigint;
    accountId: bigint;
  }): Promise<OrderCardSource | null> {
    const order = await this.prisma.order.findFirst({
      where: { id: args.orderId, account_id: args.accountId },
      select: {
        id: true,
        order_number: true,
        pickup_at: true,
        submitted_at: true,
        items: {
          where: activeWhere,
          orderBy: { id: 'asc' },
          take: 1,
          select: {
            store_id: true,
            product_name_snapshot: true,
            product_thumbnail_url_snapshot: true,
            custom_preview_image_url: true,
          },
        },
      },
    });
    const item = order?.items[0];
    if (!order || !item) return null;
    return {
      orderId: order.id,
      orderNumber: order.order_number,
      storeId: item.store_id,
      productName: item.product_name_snapshot,
      thumbnailUrl:
        item.custom_preview_image_url ?? item.product_thumbnail_url_snapshot,
      pickupAt: order.pickup_at,
      submittedAt: order.submitted_at,
    };
  }

  async existsInProgressOrderAtStore(args: {
    accountId: bigint;
    storeId: bigint;
  }): Promise<boolean> {
    const found = await this.prisma.order.findFirst({
      where: {
        account_id: args.accountId,
        status: { in: [...IN_PROGRESS_ORDER_STATUSES] },
        items: { some: { store_id: args.storeId, ...activeWhere } },
      },
      select: { id: true },
    });
    return found !== null;
  }
}
