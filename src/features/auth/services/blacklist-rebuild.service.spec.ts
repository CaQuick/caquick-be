import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { BlacklistRebuildRepository } from '@/features/auth/repositories/blacklist-rebuild.repository';
import { BlacklistRebuildService } from '@/features/auth/services/blacklist-rebuild.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import {
  credentialCutoffSec,
  TokenBlacklistService,
} from '@/global/auth/blacklist';
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

  // 팩토리는 갱신 시각을 받지 않는다 — 만든 뒤 시각만 되돌린다(@updatedAt은 명시한 값을 존중한다)
  async function suspendedAt(updatedAt: Date) {
    const account = await createAccount(prisma, { status: 'SUSPENDED' });
    await prisma.account.update({
      where: { id: account.id },
      data: { updated_at: updatedAt },
    });
    return account;
  }
  async function passwordChangedAt(changedAt: Date) {
    const credential = await createAccountCredential(prisma, {
      account_type: 'SELLER',
    });
    await prisma.accountCredential.update({
      where: { account_id: credential.account_id },
      data: { password_updated_at: changedAt },
    });
    return credential.account_id;
  }

  it('TTL 창 안의 정지·탈퇴·비밀번호 변경을 다시 등록하고 표식을 세운다 — 창 밖은 건드리지 않는다', async () => {
    const inWindow = new Date(NOW.getTime() - TTL_MS / 2);
    const outOfWindow = new Date(NOW.getTime() - TTL_MS * 2);
    const suspended = await suspendedAt(inWindow);
    const oldSuspended = await suspendedAt(outOfWindow);
    const deleted = await createAccount(prisma, { deleted_at: inWindow });
    const changed = await passwordChangedAt(inWindow);
    const oldChanged = await passwordChangedAt(outOfWindow);

    await expect(blacklist.lookup(suspended.id)).resolves.toMatchObject({
      ready: false,
    });

    const result = await service.rebuild();

    expect(result).toEqual({ suspended: 1, deleted: 1, credentials: 1 });
    await expect(blacklist.lookup(suspended.id)).resolves.toEqual({
      ready: true,
      status: 'SUSPENDED',
      credentialCutoffSec: null,
    });
    await expect(blacklist.lookup(deleted.id)).resolves.toMatchObject({
      status: 'DELETED',
    });
    await expect(blacklist.lookup(changed)).resolves.toMatchObject({
      status: null,
      credentialCutoffSec: credentialCutoffSec(inWindow),
    });
    await expect(blacklist.lookup(oldSuspended.id)).resolves.toMatchObject({
      status: null,
    });
    await expect(blacklist.lookup(oldChanged)).resolves.toMatchObject({
      credentialCutoffSec: null,
    });
  });

  it('반증: 복구 직후 표식이 있는 계정은 옛 스냅샷으로 정지를 되살리지 않는다', async () => {
    // 재구축이 DB를 읽은 뒤 복구가 커밋된 상황을 흉내 낸다 — DB는 아직 SUSPENDED, Redis엔 복구 표식
    const reinstated = await suspendedAt(NOW);
    await blacklist.clearStatus(reinstated.id);

    await service.rebuild();

    await expect(blacklist.lookup(reinstated.id)).resolves.toEqual({
      ready: true,
      status: null,
      credentialCutoffSec: null,
    });
  });

  it('반증: 아무것도 없어도 표식은 세운다(빈 목록도 완전한 목록이다)', async () => {
    await expect(service.rebuild()).resolves.toEqual({
      suspended: 0,
      deleted: 0,
      credentials: 0,
    });
    await expect(blacklist.lookup(BigInt(1))).resolves.toEqual({
      ready: true,
      status: null,
      credentialCutoffSec: null,
    });
  });
});
