/**
 * 시드 알림 (user1, 5건).
 * - 3개월 내 4건(읽음 1 / 안읽음 3 → unreadNotificationCount=3):
 *   주문확정·제작완료·픽업완료·리뷰 좋아요 — 알림센터 4종 이벤트 재현.
 * - 3개월 경과 1건: myNotifications 3개월 노출 필터 검증용(목록·배지에서 제외).
 * 문구는 notification feature 상수(figma notification-center 톤)와 동일하게 유지.
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededOrders } from './orders';
import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export async function seedNotifications(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores; orders: SeededOrders },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedNotifications');
  const [p1, p2, p3] = ctx.stores.products;
  if (!p1 || !p2 || !p3) {
    throw new Error('seedStores must run before seedNotifications');
  }

  // 리뷰 좋아요 알림은 seedReviews가 만든 user1 리뷰(p1, storeA)에 연결한다.
  const review = await prisma.review.findFirstOrThrow({
    where: { account_id: user1.id, product_id: p1.id },
    select: { id: true, store_id: true, product_id: true },
  });

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  await prisma.notification.createMany({
    data: [
      {
        account_id: user1.id,
        type: 'REVIEW_LIKE',
        event: 'REVIEW_LIKED',
        title: '리뷰 좋아요',
        body: '다른 사람이 내가 남긴 리뷰를 좋아했어요.',
        review_id: review.id,
        store_id: review.store_id,
        product_id: review.product_id,
        read_at: null,
        created_at: new Date(now - 1 * hour),
      },
      {
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_CONFIRMED',
        title: '주문확정',
        body: 'SEED-O2-CONF 주문이 확정되었어요.',
        order_id: ctx.orders.o2Confirmed,
        store_id: p2.store_id,
        product_id: p2.id,
        read_at: null,
        created_at: new Date(now - 5 * hour),
      },
      {
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_MADE',
        title: '제작완료',
        body: 'SEED-O3-MADE 주문하신 케이크 제작이 완료되었어요.',
        order_id: ctx.orders.o3Made,
        store_id: p3.store_id,
        product_id: p3.id,
        read_at: null,
        created_at: new Date(now - 1 * day),
      },
      {
        // 연관 ID 미저장 과거 주문 알림 재현 — 조회 시 order.items 폴백 검증용.
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_PICKED_UP',
        title: '픽업완료',
        body: 'SEED-O4-PICKED-RE 케이크 픽업이 완료되었어요.',
        order_id: ctx.orders.o4PickedUpReviewed,
        read_at: new Date(now - 9 * day),
        created_at: new Date(now - 10 * day),
      },
      {
        // 3개월(+7일) 경과 — 알림센터 목록·배지 어디에도 노출되지 않아야 한다.
        account_id: user1.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_PICKED_UP',
        title: '픽업완료',
        body: 'SEED-OLD 케이크 픽업이 완료되었어요.',
        read_at: null,
        created_at: new Date(now - 97 * day),
      },
    ],
  });
}
