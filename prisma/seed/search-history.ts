/**
 * 시드 검색 히스토리 (user1, 3건).
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededUser } from './users';

export async function seedSearchHistory(
  prisma: PrismaClient,
  ctx: { users: SeededUser[] },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedSearchHistory');

  const now = Date.now();
  const hour = 60 * 60 * 1000;

  await prisma.searchHistory.createMany({
    data: [
      {
        account_id: user1.id,
        keyword: '레터링 케이크',
        last_used_at: new Date(now - 1 * hour),
      },
      {
        account_id: user1.id,
        keyword: '도넛',
        last_used_at: new Date(now - 5 * hour),
      },
      {
        account_id: user1.id,
        keyword: '캐릭터',
        last_used_at: new Date(now - 24 * hour),
      },
    ],
  });
}
