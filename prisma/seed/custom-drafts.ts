/**
 * 시드 커스텀 드래프트 (user1, 2건). customDraftCount=2.
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export async function seedCustomDrafts(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedCustomDrafts');
  const [p1, , p3] = ctx.stores.products;

  await prisma.customDraft.createMany({
    data: [
      {
        account_id: user1.id,
        product_id: p1.id,
        status: 'IN_PROGRESS',
      },
      {
        account_id: user1.id,
        product_id: p3.id,
        status: 'READY_FOR_ORDER',
      },
    ],
  });
}
