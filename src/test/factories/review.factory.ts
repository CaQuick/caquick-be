import type { PrismaClient, Review } from '@/generated/prisma/client';
import { createOrderItem } from '@/test/factories/order.factory';

export interface ReviewOverrides {
  order_item_id?: bigint;
  rating?: number;
  content?: string | null;
}

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
