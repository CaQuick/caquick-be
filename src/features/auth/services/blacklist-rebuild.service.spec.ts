import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { BlacklistRebuildRepository } from '@/features/auth/repositories/blacklist-rebuild.repository';
import {
  BLACKLIST_REBUILD_INTERVAL_MS,
  BlacklistRebuildService,
} from '@/features/auth/services/blacklist-rebuild.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import {
  BLACKLIST_READY_TTL_SECONDS,
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
const IN_WINDOW = new Date(NOW.getTime() - TTL_MS / 2);
const OUT_OF_WINDOW = new Date(NOW.getTime() - TTL_MS * 2);
const NONE = { suspended: 0, deleted: 0, credentials: 0, reconciled: 0 };

// Redis가 비어도(재시작·flush) worker가 DB에서 창 안의 차단을 다시 채우고 표식을 세운다 — 전략이 DB 폴백에서 벗어나는 조건.
describe('BlacklistRebuildService (real DB + real Redis)', () => {
  let service: BlacklistRebuildService;
  let blacklist: TokenBlacklistService;
  let repo: BlacklistRebuildRepository;
  let prisma: PrismaClient;
  let redis: Redis;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };

  beforeAll(async () => {
    redis = await connectTestRedis();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        BlacklistRebuildService,
        BlacklistRebuildRepository,
        TokenBlacklistService,
        ...redisTestProviders(redis),
        { provide: AlertService, useValue: alerts },
        { provide: ClockService, useValue: { now: () => NOW } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
      ],
    });
    service = module.get(BlacklistRebuildService);
    blacklist = module.get(TokenBlacklistService);
    repo = module.get(BlacklistRebuildRepository);
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
    alerts.notify.mockClear();
  });

  it('표식 임대는 재구축 주기의 2배 이상이다 — 한 주기를 놓쳤다고 폴백으로 튀지 않게', () => {
    expect(BLACKLIST_READY_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(
      2 * BLACKLIST_REBUILD_INTERVAL_MS,
    );
  });

  // 팩토리는 갱신 시각을 받지 않는다 — 만든 뒤 시각만 되돌린다(@updatedAt은 명시한 값을 존중한다)
  async function accountAt(status: 'SUSPENDED' | 'ACTIVE', updatedAt: Date) {
    const account = await createAccount(prisma, { status });
    await prisma.account.update({
      where: { id: account.id },
      data: { updated_at: updatedAt },
    });
    return account.id;
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
  const statusOf = async (id: bigint) => (await blacklist.lookup(id)).status;

  it('TTL 창 안의 정지·탈퇴·비밀번호 변경을 다시 등록하고 표식을 세운다 — 창 밖은 건드리지 않는다', async () => {
    const suspended = await accountAt('SUSPENDED', IN_WINDOW);
    const oldSuspended = await accountAt('SUSPENDED', OUT_OF_WINDOW);
    const deleted = await createAccount(prisma, { deleted_at: IN_WINDOW });
    const changed = await passwordChangedAt(IN_WINDOW);
    const oldChanged = await passwordChangedAt(OUT_OF_WINDOW);

    await expect(blacklist.lookup(suspended)).resolves.toMatchObject({
      ready: false,
    });

    await expect(service.rebuild()).resolves.toEqual({
      ...NONE,
      suspended: 1,
      deleted: 1,
      credentials: 1,
    });

    await expect(blacklist.lookup(suspended)).resolves.toEqual({
      ready: true,
      status: 'SUSPENDED',
      credentialCutoffSec: null,
    });
    expect(await statusOf(deleted.id)).toBe('DELETED');
    await expect(blacklist.lookup(changed)).resolves.toMatchObject({
      status: null,
      credentialCutoffSec: credentialCutoffSec(IN_WINDOW),
    });
    expect(await statusOf(oldSuspended)).toBeNull();
    await expect(blacklist.lookup(oldChanged)).resolves.toMatchObject({
      credentialCutoffSec: null,
    });
  });

  it('반증: 재구축이 DB를 읽은 뒤 복구가 끼어들어도 옛 스냅샷으로 정지를 되살리지 않는다', async () => {
    // DB는 아직 SUSPENDED(IN_WINDOW)이지만 Redis엔 그보다 새 버전의 복구가 먼저 적혔다
    const reinstated = await accountAt('SUSPENDED', IN_WINDOW);
    await blacklist.clearStatus(
      reinstated,
      new Date(IN_WINDOW.getTime() + 1_000),
    );

    await service.rebuild();

    expect(await statusOf(reinstated)).toBeNull();
  });

  it('조정: 복구 쓰기가 실패해 Redis에 정지로 남은 계정을 DB 기준(활성)으로 되돌린다', async () => {
    const reinstated = await accountAt('ACTIVE', IN_WINDOW);
    await blacklist.blockStatus(
      reinstated,
      'SUSPENDED',
      new Date(IN_WINDOW.getTime() - 60_000),
    );
    expect(await statusOf(reinstated)).toBe('SUSPENDED');

    await expect(service.rebuild()).resolves.toEqual({
      ...NONE,
      reconciled: 1,
    });

    expect(await statusOf(reinstated)).toBeNull();
  });

  it('반증: 조정이 DB를 읽은 뒤 끼어든 더 새 정지는 덮지 않는다', async () => {
    // DB는 ACTIVE(IN_WINDOW)로 읽혔지만 Redis엔 그보다 새 버전의 정지가 있다(훅이 방금 적었다)
    const account = await accountAt('ACTIVE', IN_WINDOW);
    await blacklist.blockStatus(
      account,
      'SUSPENDED',
      new Date(IN_WINDOW.getTime() + 1_000),
    );

    await expect(service.rebuild()).resolves.toMatchObject({ reconciled: 1 });

    expect(await statusOf(account)).toBe('SUSPENDED');
  });

  it('반증: 쓰기가 하나라도 실패하면 표식을 세우지 않고 던진다 — 빠진 키를 활성으로 믿지 않게', async () => {
    await accountAt('SUSPENDED', IN_WINDOW);
    await accountAt('SUSPENDED', IN_WINDOW);
    const write = jest
      .spyOn(blacklist, 'blockStatus')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const ready = jest.spyOn(blacklist, 'markReady');

    await expect(service.rebuild()).rejects.toThrow('쓰기 1건 실패');

    expect(ready).not.toHaveBeenCalled();
    await expect(blacklist.lookup(BigInt(1))).resolves.toMatchObject({
      ready: false,
    });
    write.mockRestore();
    ready.mockRestore();
  });

  it('반증: DB 스냅샷 뒤 다른 프로세스의 훅 쓰기가 실패하면 표식을 세우지 않고 던진다', async () => {
    const flaky = new TokenBlacklistService(
      {
        eval: () => Promise.reject(new Error('down')),
        multi: () => redis.multi(),
      } as unknown as Redis,
      { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
      alerts as unknown as AlertService,
    );
    const real = repo.suspendedSince.bind(repo);
    const snapshot = jest
      .spyOn(repo, 'suspendedSince')
      .mockImplementationOnce(async (since) => {
        // 스냅샷을 뜨는 사이 api 프로세스의 정지 훅이 실패했다
        await flaky.blockStatus(BigInt(99), 'SUSPENDED', NOW);
        return real(since);
      });

    await expect(service.rebuild()).rejects.toThrow('세대 변화');

    await expect(blacklist.lookup(BigInt(99))).resolves.toMatchObject({
      ready: false,
    });
    snapshot.mockRestore();
  });

  it('반증: 축출 정책이 위험하면 표식을 세우지 않고 던지며 경보를 남긴다', async () => {
    const risk = jest
      .spyOn(blacklist, 'evictionRisk')
      .mockResolvedValueOnce('maxmemory=1 maxmemory-policy=volatile-lru');

    await expect(service.rebuild()).rejects.toThrow('축출 정책 위험');

    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        key: 'auth-blacklist-eviction-policy',
      }),
    );
    await expect(blacklist.lookup(BigInt(1))).resolves.toMatchObject({
      ready: false,
    });
    risk.mockRestore();
  });

  it('반증: 아무것도 없어도 표식은 세운다(빈 목록도 완전한 목록이다)', async () => {
    await expect(service.rebuild()).resolves.toEqual(NONE);
    await expect(blacklist.lookup(BigInt(1))).resolves.toEqual({
      ready: true,
      status: null,
      credentialCutoffSec: null,
    });
  });
});
