import { AccountUserRepository } from '@/features/auth/repositories/account-user.repository';
import { UserViewerCountsService } from '@/features/mypage/services/mypage-viewer-counts.service';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createNotification,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserViewerCountsService (real DB)', () => {
  let service: UserViewerCountsService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AccountUserRepository,
        NotificationRepository,
        WishlistRepository,
        UserViewerCountsService,
      ],
    });
    service = module.get(UserViewerCountsService);
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

  describe('viewerCounts', () => {
    it('미읽 알림 수 / 위시리스트 수를 반환한다', async () => {
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

    it('계정이 없으면 401을 던진다', async () => {
      await expect(service.viewerCounts(BigInt(999999))).rejects.toThrowDomain(
        401,
      );
    });
  });
});
