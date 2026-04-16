import type { PrismaClient, Review } from '@prisma/client';

import { createOrderItem } from '@/test/factories/order.factory';

export interface ReviewOverrides {
  order_item_id?: bigint;
  rating?: number;
  content?: string | null;
}

/**
 * Review 팩토리.
 *
 * - order_item_id가 주어지면 해당 아이템의 관계(account, store, product)를 그대로 사용
 * - order_item_id가 없으면 새 order item을 생성하고 그 관계를 사용
 * - account_id/store_id/product_id는 항상 order item에서 파생 (직접 override 불가, 일관성 보장)
 */
export async function createReview(
  prisma: PrismaClient,
  overrides: ReviewOverrides = {},
): Promise<Review> {
  let orderItemId = overrides.order_item_id;
  let accountId: bigint;
  let storeId: bigint;
  let productId: bigint;

  if (orderItemId) {
    const oi = await prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      include: { order: true },
    });
    storeId = oi.store_id;
    productId = oi.product_id;
    accountId = oi.order.account_id;
  } else {
    const oi = await createOrderItem(prisma);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: oi.order_id },
    });
    orderItemId = oi.id;
    storeId = oi.store_id;
    productId = oi.product_id;
    accountId = order.account_id;
  }

  return prisma.review.create({
    data: {
      order_item_id: orderItemId,
      account_id: accountId,
      store_id: storeId,
      product_id: productId,
      rating: overrides.rating ?? 5,
      content:
        overrides.content === undefined
          ? '좋은 제품입니다.'
          : overrides.content,
    },
  });
}
