import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createNotification,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserNotificationService (real DB)', () => {
  let service: UserNotificationService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserNotificationService, UserRepository],
    });
    service = module.get(UserNotificationService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupUser() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account;
  }

  // 3개월 노출 필터가 "지금" 기준이라 케이스 날짜도 상대 시각으로 만든다
  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  // ─── viewerCounts ───
  describe('viewerCounts', () => {
    it('미읽 알림 수 / 장바구니 / 위시리스트 수를 반환한다', async () => {
      const account = await setupUser();

      // 미읽 알림 2개 + 읽음 알림 1개
      await createNotification(prisma, { account_id: account.id });
      await createNotification(prisma, { account_id: account.id });
      await createNotification(prisma, {
        account_id: account.id,
        read_at: new Date(),
      });

      const result = await service.viewerCounts(account.id);

      expect(result.unreadNotificationCount).toBe(2);
      expect(result.cartItemCount).toBe(0);
      expect(result.wishlistCount).toBe(0);
    });

    it('3개월 지난 미읽 알림은 배지 수에서 제외한다(목록과 일치)', async () => {
      const account = await setupUser();
      await createNotification(prisma, { account_id: account.id });
      await createNotification(prisma, {
        account_id: account.id,
        created_at: daysAgo(100),
      });

      const result = await service.viewerCounts(account.id);

      expect(result.unreadNotificationCount).toBe(1);
    });

    it('계정이 없으면 UnauthorizedException을 던진다', async () => {
      await expect(service.viewerCounts(BigInt(999999))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── myNotifications ───
  describe('myNotifications', () => {
    it('알림 목록을 created_at desc로 반환하고 DTO 변환한다', async () => {
      const account = await setupUser();

      const older = await createNotification(prisma, {
        account_id: account.id,
        title: '오래된',
        body: '바디1',
        created_at: daysAgo(2),
      });
      const newer = await createNotification(prisma, {
        account_id: account.id,
        title: '최근',
        body: '바디2',
        event: 'ORDER_CONFIRMED',
        created_at: daysAgo(1),
      });

      const result = await service.myNotifications(account.id, { limit: 10 });

      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0].id).toBe(newer.id.toString());
      expect(result.items[1].id).toBe(older.id.toString());
      expect(result.items[0].title).toBe('최근');
      expect(result.items[0].event).toBe('ORDER_CONFIRMED');
      expect(result.items[0].readAt).toBeNull();
      // 연관 엔티티가 없는 알림은 부가 필드가 모두 null
      expect(result.items[0].storeId).toBeNull();
      expect(result.items[0].storeName).toBeNull();
      expect(result.items[0].productName).toBeNull();
    });

    it('unreadOnly=true면 read_at이 null인 것만 반환한다', async () => {
      const account = await setupUser();
      await createNotification(prisma, {
        account_id: account.id,
        read_at: new Date(),
      });
      await createNotification(prisma, { account_id: account.id });

      const result = await service.myNotifications(account.id, {
        unreadOnly: true,
        limit: 10,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].readAt).toBeNull();
    });

    it('커서로 다음 페이지를 이어간다 — 같은 created_at은 id로 타이브레이크', async () => {
      const account = await setupUser();
      const sameMoment = daysAgo(1);
      const ids: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        const n = await createNotification(prisma, {
          account_id: account.id,
          created_at: sameMoment,
        });
        ids.push(n.id);
      }
      const idDesc = [...ids].sort((a, b) => (a < b ? 1 : -1));

      const page1 = await service.myNotifications(account.id, { limit: 2 });
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.items.map((i) => i.id)).toEqual([
        idDesc[0].toString(),
        idDesc[1].toString(),
      ]);

      const page2 = await service.myNotifications(account.id, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((i) => i.id)).toEqual([idDesc[2].toString()]);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
      // totalCount는 커서와 무관하게 전체 기준을 유지한다
      expect(page2.totalCount).toBe(3);
    });

    it('형식이 잘못된 커서는 거절한다', async () => {
      const account = await setupUser();

      await expect(
        service.myNotifications(account.id, { cursor: 'abc' }),
      ).rejects.toThrow(BadRequestException);
      // 자릿수 폭탄 — Number 변환 시 안전 정수 범위를 벗어나는 값
      await expect(
        service.myNotifications(account.id, { cursor: `${'9'.repeat(30)}:1` }),
      ).rejects.toThrow(BadRequestException);
      // 안전 정수지만 Date 지원 범위(±8.64e15ms)를 넘는 timestamp
      await expect(
        service.myNotifications(account.id, { cursor: '9000000000000000:1' }),
      ).rejects.toThrow(BadRequestException);
      // UNSIGNED BIGINT 상한을 넘는 id
      await expect(
        service.myNotifications(account.id, {
          cursor: `1700000000000:${'9'.repeat(30)}`,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('3개월 지난 알림은 목록·totalCount에서 제외한다', async () => {
      const account = await setupUser();
      const recent = await createNotification(prisma, {
        account_id: account.id,
        created_at: daysAgo(80),
      });
      await createNotification(prisma, {
        account_id: account.id,
        created_at: daysAgo(100),
      });

      const result = await service.myNotifications(account.id);

      expect(result.totalCount).toBe(1);
      expect(result.items.map((i) => i.id)).toEqual([recent.id.toString()]);
    });

    it('직접 연결된 매장·상품·리뷰 정보를 노출한다(리뷰 좋아요 형태)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { store_name: '달콤 케이크' });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '크리스마스 케이크',
      });
      const review = await createReview(prisma, {
        order_item_id: (
          await createOrderItem(prisma, { product_id: product.id })
        ).id,
      });

      const notif = await createNotification(prisma, {
        account_id: account.id,
        type: 'REVIEW_LIKE',
        event: 'REVIEW_LIKED',
        store_id: store.id,
        product_id: product.id,
        review_id: review.id,
      });

      const result = await service.myNotifications(account.id);

      const item = result.items.find((i) => i.id === notif.id.toString());
      expect(item).toMatchObject({
        event: 'REVIEW_LIKED',
        storeId: store.id.toString(),
        storeName: '달콤 케이크',
        productId: product.id.toString(),
        productName: '크리스마스 케이크',
        reviewId: review.id.toString(),
      });
    });

    it('연관 ID가 없는 과거 주문 알림은 order.items로 매장·상품을 보강한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { store_name: '해즈 케이크' });
      const product = await createProduct(prisma, { store_id: store.id });
      const order = await createOrder(prisma, { account_id: account.id });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
        product_name_snapshot: '주문 시점 상품명',
      });

      const notif = await createNotification(prisma, {
        account_id: account.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_PICKED_UP',
        order_id: order.id,
        // store_id / product_id 미저장 — 과거 데이터 재현
      });

      const result = await service.myNotifications(account.id);

      const item = result.items.find((i) => i.id === notif.id.toString());
      expect(item).toMatchObject({
        orderId: order.id.toString(),
        storeId: store.id.toString(),
        storeName: '해즈 케이크',
        productId: product.id.toString(),
        // 주문 폴백의 상품명은 스냅샷을 쓴다(상품 삭제·개명에도 안전)
        productName: '주문 시점 상품명',
      });
    });

    it('다른 계정의 알림은 섞여 나오지 않는다', async () => {
      const me = await setupUser();
      const other = await setupUser();
      await createNotification(prisma, { account_id: me.id });
      await createNotification(prisma, { account_id: other.id });

      const result = await service.myNotifications(me.id);

      expect(result.totalCount).toBe(1);
    });
  });

  // ─── markNotificationRead ───
  describe('markNotificationRead', () => {
    it('미읽 상태면 read_at을 현재 시각으로 설정하고 true 반환', async () => {
      const account = await setupUser();
      const notif = await createNotification(prisma, {
        account_id: account.id,
      });

      const result = await service.markNotificationRead(account.id, notif.id);

      expect(result).toBe(true);
      const saved = await prisma.notification.findUniqueOrThrow({
        where: { id: notif.id },
      });
      expect(saved.read_at).not.toBeNull();
    });

    it('이미 읽은 알림이면 기존 read_at을 유지하고 true 반환', async () => {
      const account = await setupUser();
      const firstReadAt = new Date('2026-01-01');
      const notif = await createNotification(prisma, {
        account_id: account.id,
        read_at: firstReadAt,
      });

      const result = await service.markNotificationRead(account.id, notif.id);

      expect(result).toBe(true);
      const saved = await prisma.notification.findUniqueOrThrow({
        where: { id: notif.id },
      });
      expect(saved.read_at?.getTime()).toBe(firstReadAt.getTime());
    });

    it('존재하지 않는 알림이면 NotFoundException', async () => {
      const account = await setupUser();
      await expect(
        service.markNotificationRead(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 계정의 알림은 접근 불가 (NotFoundException)', async () => {
      const me = await setupUser();
      const other = await setupUser();
      const othersNotif = await createNotification(prisma, {
        account_id: other.id,
      });

      await expect(
        service.markNotificationRead(me.id, othersNotif.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── markAllNotificationsRead ───
  describe('markAllNotificationsRead', () => {
    it('해당 계정의 미읽 알림 모두를 읽음 처리', async () => {
      const account = await setupUser();
      await createNotification(prisma, { account_id: account.id });
      await createNotification(prisma, { account_id: account.id });
      const alreadyRead = await createNotification(prisma, {
        account_id: account.id,
        read_at: new Date('2026-01-01'),
      });

      const result = await service.markAllNotificationsRead(account.id);

      expect(result).toBe(true);

      const unreadCount = await prisma.notification.count({
        where: { account_id: account.id, read_at: null },
      });
      expect(unreadCount).toBe(0);

      // 기존에 읽은 알림의 read_at은 덮어쓰지 않는다
      const preserved = await prisma.notification.findUniqueOrThrow({
        where: { id: alreadyRead.id },
      });
      expect(preserved.read_at?.getTime()).toBe(
        new Date('2026-01-01').getTime(),
      );
    });

    it('다른 계정 알림은 영향을 받지 않는다', async () => {
      const me = await setupUser();
      const other = await setupUser();
      await createNotification(prisma, { account_id: me.id });
      await createNotification(prisma, { account_id: other.id });

      await service.markAllNotificationsRead(me.id);

      const otherUnread = await prisma.notification.count({
        where: { account_id: other.id, read_at: null },
      });
      expect(otherUnread).toBe(1);
    });
  });
});
