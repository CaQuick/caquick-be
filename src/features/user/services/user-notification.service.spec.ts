import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createNotification,
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
        created_at: new Date('2026-04-01'),
      });
      const newer = await createNotification(prisma, {
        account_id: account.id,
        title: '최근',
        body: '바디2',
        created_at: new Date('2026-04-20'),
      });

      const result = await service.myNotifications(account.id, {
        offset: 0,
        limit: 10,
      });

      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.items[0].id).toBe(newer.id.toString());
      expect(result.items[1].id).toBe(older.id.toString());
      expect(result.items[0].title).toBe('최근');
      expect(result.items[0].readAt).toBeNull();
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
        offset: 0,
        limit: 10,
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].readAt).toBeNull();
    });

    it('offset + limit < totalCount면 hasMore true', async () => {
      const account = await setupUser();
      for (let i = 0; i < 3; i++) {
        await createNotification(prisma, {
          account_id: account.id,
          created_at: new Date(2026, 3, 20 - i),
        });
      }

      const result = await service.myNotifications(account.id, {
        offset: 0,
        limit: 2,
      });

      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(2);
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
