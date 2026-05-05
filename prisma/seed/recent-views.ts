/**
 * 시드 최근 본 상품 (user1, 4건).
 * viewed_at에 시간 차이를 두어 정렬 검증 가능.
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export async function seedRecentViews(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedRecentViews');
  const [p1, p2, p3, p4] = ctx.stores.products;

  const now = Date.now();
  const minute = 60 * 1000;

  await prisma.recentProductView.createMany({
    data: [
      {
        account_id: user1.id,
        product_id: p1.id,
        viewed_at: new Date(now - 5 * minute),
      },
      {
        account_id: user1.id,
        product_id: p2.id,
        viewed_at: new Date(now - 30 * minute),
      },
      {
        account_id: user1.id,
        product_id: p3.id,
        viewed_at: new Date(now - 2 * 60 * minute),
      },
      {
        account_id: user1.id,
        product_id: p4.id,
        viewed_at: new Date(now - 24 * 60 * minute),
      },
    ],
  });
}
