import type { PrismaClient, Review } from '@prisma/client';

import { createOrderItem } from '@/test/factories/order.factory';

export interface ReviewOverrides {
  order_item_id?: bigint;
  account_id?: bigint;
  store_id?: bigint;
  product_id?: bigint;
  rating?: number;
  content?: string | null;
}

export async function createReview(
  prisma: PrismaClient,
  overrides: ReviewOverrides = {},
): Promise<Review> {
  let orderItemId = overrides.order_item_id;
  let accountId = overrides.account_id;
  let storeId = overrides.store_id;
  let productId = overrides.product_id;

  if (orderItemId && (!accountId || !storeId || !productId)) {
    // order_item_id가 주어졌으면 해당 아이템의 관계를 조회하여 일관성 유지
    const oi = await prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      include: { order: true },
    });
    storeId = storeId ?? oi.store_id;
    productId = productId ?? oi.product_id;
    accountId = accountId ?? oi.order.account_id;
  } else if (!orderItemId) {
    // order_item_id가 없으면 새로 생성
    const oi = await createOrderItem(prisma);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: oi.order_id },
    });
    orderItemId = oi.id;
    storeId = storeId ?? oi.store_id;
    productId = productId ?? oi.product_id;
    accountId = accountId ?? order.account_id;
  }

  return prisma.review.create({
    data: {
      order_item_id: orderItemId,
      account_id: accountId!,
      store_id: storeId!,
      product_id: productId!,
      rating: overrides.rating ?? 5,
      content:
        overrides.content === undefined
          ? '좋은 제품입니다.'
          : overrides.content,
    },
  });
}
