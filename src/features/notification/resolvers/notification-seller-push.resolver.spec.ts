import { ValidationPipe } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SellerRegisterPushTokenInput } from '@/features/notification/dto/inputs/seller-register-push-token.input';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { SellerPushDeviceMutationResolver } from '@/features/notification/resolvers/notification-seller-push-mutation.resolver';
import { SellerPushDeviceService } from '@/features/notification/services/seller-push-device.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerPushDeviceMutationResolver (real DB)', () => {
  let resolver: SellerPushDeviceMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerPushDeviceMutationResolver,
        SellerPushDeviceService,
        SellerPushDeviceRepository,
        StoreSellerRepository,
        ClockService,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    resolver = module.get(SellerPushDeviceMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('등록 → 해제가 세션 계정 기준으로 한 행에 반영된다', async () => {
    const seller = await setupSellerWithStore(prisma);
    const user = { accountId: seller.account.id.toString() };
    const token = 'ExpoPushToken[resolver-1]';

    await expect(
      resolver.sellerRegisterPushToken(user, { token, platform: 'ANDROID' }),
    ).resolves.toBe(true);
    const registered = await prisma.sellerPushDevice.findFirstOrThrow();
    expect(registered).toMatchObject({
      account_id: seller.account.id,
      store_id: seller.store.id,
      platform: 'ANDROID',
      disabled_at: null,
    });

    await expect(
      resolver.sellerUnregisterPushToken(user, { token }),
    ).resolves.toBe(true);
    const row = await prisma.sellerPushDevice.findFirstOrThrow();
    expect(row.disabled_reason).toBe('UNREGISTERED');
    expect(row.disabled_at).not.toBeNull();
  });

  it('형식 밖 토큰은 ValidationPipe를 통과해 서비스의 INVALID_PUSH_TOKEN으로 끝난다', async () => {
    const seller = await setupSellerWithStore(prisma);
    // main.ts와 같은 옵션 — DTO가 먼저 걸면 VALIDATION_FAILED가 돼 SDL 계약과 어긋난다
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const input = (await pipe.transform(
      { token: 'not-a-token', platform: 'IOS' },
      { type: 'body', metatype: SellerRegisterPushTokenInput },
    )) as SellerRegisterPushTokenInput;

    await expect(
      resolver.sellerRegisterPushToken(
        { accountId: seller.account.id.toString() },
        input,
      ),
    ).rejects.toThrowDomain('INVALID_PUSH_TOKEN');
    expect(await prisma.sellerPushDevice.count()).toBe(0);
  });
});
