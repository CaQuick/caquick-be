/**
 * 시드 알림 (user1, 3건). 읽음 1 / 안읽음 2 → unreadNotificationCount=2.
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededUser } from './users';

export async function seedNotifications(
  prisma: PrismaClient,
  ctx: { users: SeededUser[] },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedNotifications');

  const now = Date.now();
  const hour = 60 * 60 * 1000;

  await prisma.notification.createMany({
    data: [
      {
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_CONFIRMED',
        title: '주문이 확정되었습니다',
        body: 'SEED-O2-CONF 주문이 확정되었습니다.',
        read_at: null,
        created_at: new Date(now - 1 * hour),
      },
      {
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_MADE',
        title: '주문이 제작 완료되었습니다',
        body: 'SEED-O3-MADE 주문의 상품 제작이 완료되었습니다.',
        read_at: null,
        created_at: new Date(now - 24 * hour),
      },
      {
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_PICKED_UP',
        title: '주문이 픽업 처리되었습니다',
        body: 'SEED-O4-PICKED-RE 주문이 픽업 완료 처리되었습니다.',
        read_at: new Date(now - 9 * 24 * hour),
        created_at: new Date(now - 10 * 24 * hour),
      },
    ],
  });
}
