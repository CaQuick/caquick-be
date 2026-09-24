import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { BlacklistRebuildRepository } from '@/features/auth/repositories/blacklist-rebuild.repository';
import { BlacklistRebuildService } from '@/features/auth/services/blacklist-rebuild.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import { TokenBlacklistService } from '@/global/auth/blacklist';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { redisTestProviders } from '@/test/redis';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const TTL_MS = TEST_AUTH_CONFIG.jwtAccessExpiresSeconds * 1000;

// Redis가 비어도(재시작·flush) worker가 DB에서 창 안의 차단을 다시 채우고 표식을 세운다 — 전략이 DB 폴백에서 벗어나는 조건.
describe('BlacklistRebuildService (real DB + real Redis)', () => {
  let service: BlacklistRebuildService;
  let blacklist: TokenBlacklistService;
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(async () => {
    redis = await connectTestRedis();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        BlacklistRebuildService,
        BlacklistRebuildRepository,
        TokenBlacklistService,
        ...redisTestProviders(redis),
        { provide: AlertService, useValue: { notify: jest.fn() } },
        { provide: ClockService, useValue: { now: () => NOW } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
      ],
    });
    service = module.get(BlacklistRebuildService);
    blacklist = module.get(TokenBlacklistService);
    prisma = p;
  });
  afterAll(async () => {
    await redis.quit();
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
    await redis.flushdb();
  });

  it('TTL 창 안의 정지·탈퇴·비밀번호 변경을 다시 등록하고 표식을 세운다 — 창 밖은 건드리지 않는다', async () => {
    const inWindow = new Date(NOW.getTime() - TTL_MS / 2);
    const outOfWindow = new Date(NOW.getTime() - TTL_MS * 2);
    // 팩토리는 갱신 시각을 받지 않는다 — 만든 뒤 시각만 되돌린다(@updatedAt은 명시한 값을 존중한다)
    const suspended = await createAccount(prisma, { status: 'SUSPENDED' });
    const oldSuspended = await createAccount(prisma, { status: 'SUSPENDED' });
    const deleted = await createAccount(prisma, { deleted_at: inWindow });
    const credential = await createAccountCredential(prisma, {
      account_type: 'SELLER',
    });
    const oldCredential = await createAccountCredential(prisma, {
      account_type: 'ADMIN',
    });
    await prisma.account.update({
      where: { id: suspended.id },
      data: { updated_at: inWindow },
    });
    await prisma.account.update({
      where: { id: oldSuspended.id },
      data: { updated_at: outOfWindow },
    });
    await prisma.accountCredential.update({
      where: { account_id: credential.account_id },
      data: { password_updated_at: inWindow },
    });
    await prisma.accountCredential.update({
      where: { account_id: oldCredential.account_id },
      data: { password_updated_at: outOfWindow },
    });

    await expect(blacklist.lookup(suspended.id)).resolves.toMatchObject({
      ready: false,
    });

    const result = await service.rebuild();

    expect(result).toEqual({ suspended: 1, deleted: 1, credentials: 1 });
    await expect(blacklist.lookup(suspended.id)).resolves.toEqual({
      ready: true,
      entry: { reason: 'SUSPENDED', issuedBeforeMs: Number.POSITIVE_INFINITY },
    });
    await expect(blacklist.lookup(deleted.id)).resolves.toMatchObject({
      entry: { reason: 'DELETED' },
    });
    await expect(
      blacklist.lookup(credential.account_id),
    ).resolves.toMatchObject({
      entry: {
        reason: 'CREDENTIAL_CHANGED',
        issuedBeforeMs: inWindow.getTime(),
      },
    });
    await expect(blacklist.lookup(oldSuspended.id)).resolves.toMatchObject({
      entry: null,
    });
    await expect(
      blacklist.lookup(oldCredential.account_id),
    ).resolves.toMatchObject({ entry: null });
  });

  it('반증: 아무것도 없어도 표식은 세운다(빈 목록도 완전한 목록이다)', async () => {
    await expect(service.rebuild()).resolves.toEqual({
      suspended: 0,
      deleted: 0,
      credentials: 0,
    });
    await expect(blacklist.lookup(BigInt(1))).resolves.toEqual({
      ready: true,
      entry: null,
    });
  });
});
