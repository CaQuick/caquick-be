/**
 * 시드 리뷰. user1이 o4의 OrderItem에 작성한 1건.
 * IMAGE 1건 + VIDEO 1건 첨부.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import type { SeededOrders } from './orders';
import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export async function seedReviews(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores; orders: SeededOrders },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedReviews');
  const [storeA] = ctx.stores.stores;
  const [p1] = ctx.stores.products;
  const orderItemId = ctx.orders.o4OrderItemId;

  await prisma.review.create({
    data: {
      order_item_id: orderItemId,
      account_id: user1.id,
      store_id: storeA.id,
      product_id: p1.id,
      rating: new Prisma.Decimal('4.5'),
      content:
        '레터링이 정말 예쁘게 나왔어요. 케이크 맛도 좋고 다음에 또 주문할게요!',
      media: {
        create: [
          {
            media_type: 'IMAGE',
            media_url: 'https://placehold.co/800x800/png?text=Review+Image',
            sort_order: 0,
          },
          {
            media_type: 'VIDEO',
            media_url: 'https://placehold.co/800x800/png?text=Review+Video.mp4',
            thumbnail_url: 'https://placehold.co/300x300/png?text=Video+Thumb',
            sort_order: 1,
          },
        ],
      },
    },
  });
}
