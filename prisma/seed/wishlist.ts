/**
 * 시드 찜 목록 (user1).
 *
 * - p1 (활성, recent-view에도 있음) → recent-view에서 isWishlisted=true
 * - p3 (활성, recent-view에 없음) → myWishlist에는 보이지만 recent-view에는 안 나옴
 * - p5 (비활성 상품) → visibleWishlistWhere로 myWishlist/wishlistCount에서 제외
 *
 * 결과: wishlistCount=2, myWishlist.totalCount=2
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export async function seedWishlist(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedWishlist');
  const [p1, , p3, , p5] = ctx.stores.products;

  await prisma.wishlistItem.createMany({
    data: [
      { account_id: user1.id, product_id: p1.id },
      { account_id: user1.id, product_id: p3.id },
      { account_id: user1.id, product_id: p5.id },
    ],
  });
}
