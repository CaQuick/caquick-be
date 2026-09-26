import { snapshotReviewOrderItem } from '@/features/review/repositories/review-order-item-snapshot.helper';
import { Prisma } from '@/generated/prisma/client';
import type { PrismaClient, Review } from '@/generated/prisma/client';
import { createOrderItem } from '@/test/factories/order.factory';

export interface ReviewOverrides {
  order_item_id?: bigint;
  /** 미지정 시 order_item에서 유도한다. */
  account_id?: bigint;
  store_id?: bigint;
  product_id?: bigint;
  rating?: number;
  content?: string | null;
  deleted_at?: Date | null;
  /** 미지정 시 작성 경로와 같은 규칙으로 order_item에서 찍는다. */
  product_name_snapshot?: string;
  option_summary?: { groupName: string; optionTitle: string }[] | null;
  before_image_url?: string | null;
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

  const snapshot = await snapshotReviewOrderItem(prisma, orderItemId);
  return prisma.review.create({
    data: {
      order_item_id: orderItemId,
      product_name_snapshot:
        overrides.product_name_snapshot ?? snapshot.product_name_snapshot,
      option_summary:
        overrides.option_summary === undefined
          ? snapshot.option_summary
          : (overrides.option_summary ?? Prisma.DbNull),
      before_image_url:
        overrides.before_image_url === undefined
          ? snapshot.before_image_url
          : overrides.before_image_url,
      account_id: overrides.account_id ?? accountId,
      store_id: overrides.store_id ?? storeId,
      product_id: overrides.product_id ?? productId,
      rating: overrides.rating ?? 5,
      deleted_at: overrides.deleted_at ?? null,
      content:
        overrides.content === undefined
          ? '좋은 제품입니다.'
          : overrides.content,
    },
  });
}
