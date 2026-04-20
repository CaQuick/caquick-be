import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserNotificationMutationResolver } from '@/features/user/resolvers/user-notification-mutation.resolver';
import { UserNotificationQueryResolver } from '@/features/user/resolvers/user-notification-query.resolver';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createNotification,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('User Notification Resolvers (real DB)', () => {
  let queryResolver: UserNotificationQueryResolver;
  let mutationResolver: UserNotificationMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserNotificationQueryResolver,
        UserNotificationMutationResolver,
        UserNotificationService,
        UserRepository,
      ],
    });
    queryResolver = module.get(UserNotificationQueryResolver);
    mutationResolver = module.get(UserNotificationMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.myNotifications가 DB에서 미읽 필터 결과를 반환한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    await createNotification(prisma, {
      account_id: account.id,
      read_at: new Date(),
    });
    await createNotification(prisma, { account_id: account.id });

    const result = await queryResolver.myNotifications(
      { accountId: account.id.toString() },
      { unreadOnly: true, offset: 0, limit: 10 },
    );

    expect(result.totalCount).toBe(1);
    expect(result.items[0].readAt).toBeNull();
  });

  it('Mutation.markNotificationRead: 성공 시 read_at 기록, 실패 시 NotFoundException 전파', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const notif = await createNotification(prisma, { account_id: account.id });

    const ok = await mutationResolver.markNotificationRead(
      { accountId: account.id.toString() },
      notif.id.toString(),
    );
    expect(ok).toBe(true);

    await expect(
      mutationResolver.markNotificationRead(
        { accountId: account.id.toString() },
        '999999',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
