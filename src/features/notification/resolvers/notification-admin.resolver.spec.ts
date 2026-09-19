// 분기/집계 세부는 admin-notification.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { AdminNotificationMutationResolver } from '@/features/notification/resolvers/notification-admin-mutation.resolver';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { OutboxDispatcherService } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

describe('Admin Notification Resolver (real DB)', () => {
  let resolver: AdminNotificationMutationResolver;
  let prisma: PrismaClient;
  let dispatcher: OutboxDispatcherService;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        AdminNotificationMutationResolver,
        AdminNotificationService,
        NotificationAdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...outboxTestProviders(),
        NotificationOutboxConsumer,
        NotificationRepository,
      ],
    });
    resolver = module.get(AdminNotificationMutationResolver);
    dispatcher = module.get(OutboxDispatcherService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Mutation.adminSendNotification(ACCOUNT_IDS) 경로', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const target = await createAccount(prisma, { account_type: 'USER' });

    const result = await resolver.adminSendNotification(
      { accountId: actor.id.toString(), accountType: 'ADMIN' },
      {
        type: 'SYSTEM',
        title: '공지',
        body: '내용',
        idempotencyKey: 'resolver-key-1',
        targetKind: 'ACCOUNT_IDS',
        accountIds: [target.id.toString()],
      },
    );

    expect(result.sentCount).toBe(1);
    // 저장은 outbox 소비자 — 소진 뒤 본다
    await drainOutbox(dispatcher);
    expect(
      await prisma.notification.count({ where: { account_id: target.id } }),
    ).toBe(1);
  });
});
