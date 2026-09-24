import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
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

const NOW = Math.floor(Date.now() / 1000);

function payload(
  sub: string,
  extra: Partial<Parameters<JwtBearerStrategy['validate']>[0]> = {},
) {
  return {
    sub,
    typ: 'access' as const,
    role: 'USER' as const,
    iat: NOW,
    exp: NOW + 3600,
    ...extra,
  };
}

/** Passport Strategy는 생성자에서 super()를 부르므로 validate만 시험하기 위해 prototype에서 만든다. */
function buildStrategy(deps: {
  accounts: AccountRepository;
  blacklist: TokenBlacklistService;
  alerts: AlertService;
}): JwtBearerStrategy {
  const instance = Object.create(
    JwtBearerStrategy.prototype,
  ) as JwtBearerStrategy & {
    accounts: AccountRepository;
    blacklist: TokenBlacklistService;
    alerts: AlertService;
  };
  Object.assign(instance, deps);
  return instance;
}

const clock = new ClockService();

describe('JwtBearerStrategy (real DB + real Redis)', () => {
  let strategy: JwtBearerStrategy;
  let blacklist: TokenBlacklistService;
  let accounts: AccountRepository;
  let prisma: PrismaClient;
  let redis: Redis;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };

  beforeAll(async () => {
    redis = await connectTestRedis();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ClockService,
        { provide: ACCOUNT_REPOSITORY, useClass: AccountRepository },
        TokenBlacklistService,
        { provide: AlertService, useValue: alerts },
        ...redisTestProviders(redis),
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
      ],
    });
    accounts = module.get<AccountRepository>(ACCOUNT_REPOSITORY);
    blacklist = module.get(TokenBlacklistService);
    strategy = buildStrategy({
      accounts,
      blacklist,
      alerts: alerts as unknown as AlertService,
    });
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
    // 정상 상태 = worker 재구축이 끝나 표식이 있는 상태
    await blacklist.markReady(await blacklist.generation());
    alerts.notify.mockClear();
  });

  describe('정상 경로 — 클레임 신뢰, DB를 읽지 않는다', () => {
    it('서명이 유효한 토큰의 클레임으로 JwtUser를 만든다(계정 조회 0회)', async () => {
      const spy = jest.spyOn(accounts, 'findAccountForJwt');

      const result = await strategy.validate(
        payload('42', { role: 'SELLER', mustChangePassword: true }),
      );

      expect(result).toEqual({
        accountId: '42',
        accountType: 'SELLER',
        mustChangePassword: true,
      });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('mustChangePassword 클레임이 없으면 false', async () => {
      const result = await strategy.validate(payload('42'));
      expect(result.mustChangePassword).toBe(false);
    });

    it('sub가 없으면 INVALID_ACCESS_TOKEN', async () => {
      await expect(strategy.validate(payload(''))).rejects.toThrowDomain(
        'INVALID_ACCESS_TOKEN',
      );
    });

    it('typ이 access가 아니면 INVALID_ACCESS_TOKEN', async () => {
      await expect(
        strategy.validate(payload('1', { typ: 'refresh' as 'access' })),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
    });

    it('sub가 정수가 아니면 INVALID_ACCESS_TOKEN', async () => {
      await expect(strategy.validate(payload('abc'))).rejects.toThrowDomain(
        'INVALID_ACCESS_TOKEN',
      );
    });
  });

  // 정지는 계정 오류(403), 탈퇴는 DB 경로와 같은 "없음"(401), 자격증명 변경은 토큰 무효(401 — FE가 refresh를 시도하게)
  describe('블랙리스트', () => {
    const AT = new Date(NOW * 1000);
    const LATER = new Date(NOW * 1000 + 1_000);

    it.each([
      ['SUSPENDED', 'ACCOUNT_NOT_ACTIVE'],
      ['DELETED', 'SESSION_ACCOUNT_MISSING'],
    ] as const)('%s → %s', async (reason, code) => {
      await blacklist.blockStatus(BigInt(42), reason, AT);

      await expect(strategy.validate(payload('42'))).rejects.toThrowDomain(
        code,
      );
    });

    it('복구(clearStatus) 뒤에는 통과한다', async () => {
      await blacklist.blockStatus(BigInt(42), 'SUSPENDED', AT);
      await blacklist.clearStatus(BigInt(42), LATER);

      await expect(strategy.validate(payload('42'))).resolves.toMatchObject({
        accountId: '42',
      });
    });

    it('자격증명 변경은 cutoff 전에 발급된 토큰만 막는다 — 같은 초·그 뒤에 받은 새 토큰은 통과', async () => {
      await blacklist.blockCredentials(BigInt(42), new Date(NOW * 1000 + 999));

      await expect(
        strategy.validate(payload('42', { iat: NOW - 1 })),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
      // 변경과 같은 초에 발급된 토큰 — iat가 초 단위라 ms 비교로 밀어내면 새 토큰까지 막는다
      await expect(
        strategy.validate(payload('42', { iat: NOW })),
      ).resolves.toMatchObject({ accountId: '42' });
      await expect(
        strategy.validate(payload('42', { iat: NOW + 1 })),
      ).resolves.toMatchObject({ accountId: '42' });
    });

    it('반증: 정지 → 복구를 거쳐도 자격증명 cutoff는 살아 옛 토큰을 계속 막는다', async () => {
      await blacklist.blockCredentials(BigInt(42), AT);
      await blacklist.blockStatus(BigInt(42), 'SUSPENDED', AT);
      await blacklist.clearStatus(BigInt(42), LATER);

      await expect(
        strategy.validate(payload('42', { iat: NOW - 60 })),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
      await expect(
        strategy.validate(payload('42', { iat: NOW })),
      ).resolves.toMatchObject({ accountId: '42' });
    });

    it('정지와 자격증명 변경이 겹치면 상태 오류가 우선한다', async () => {
      await blacklist.blockCredentials(BigInt(42), AT);
      await blacklist.blockStatus(BigInt(42), 'SUSPENDED', AT);

      await expect(
        strategy.validate(payload('42', { iat: NOW - 60 })),
      ).rejects.toThrowDomain('ACCOUNT_NOT_ACTIVE');
    });

    it('반증: 재구축 표식이 없으면(Redis 초기화) 항목이 없어도 클레임을 믿지 않고 DB로 판정한다', async () => {
      await redis.flushdb(); // 표식까지 사라진 상태
      const suspended = await createAccount(prisma, {
        account_type: 'USER',
        status: 'SUSPENDED',
      });

      await expect(
        strategy.validate(payload(suspended.id.toString())),
      ).rejects.toThrowDomain('ACCOUNT_NOT_ACTIVE');
      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'auth-blacklist-not-ready' }),
      );
    });

    it('다른 계정의 블랙리스트는 영향이 없다', async () => {
      await blacklist.blockStatus(BigInt(1), 'DELETED', AT);
      await blacklist.blockCredentials(BigInt(1), AT);

      await expect(strategy.validate(payload('42'))).resolves.toMatchObject({
        accountId: '42',
      });
    });
  });

  // 반증: Redis가 죽으면 예전 판정(계정 재조회)으로 돌아가고 경보를 남긴다 — fail-open이 아니다
  describe('Redis 장애 폴백', () => {
    let deadRedis: Redis;
    let fallbackStrategy: JwtBearerStrategy;

    beforeAll(() => {
      // 닫힌 포트 — 명령이 즉시 실패한다(오프라인 큐 없음·재시도 1회)
      deadRedis = new Redis('redis://127.0.0.1:1', {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      deadRedis.on('error', () => undefined);
      const deadBlacklist = new TokenBlacklistService(
        deadRedis,
        { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
        alerts as unknown as AlertService,
        clock,
      );
      fallbackStrategy = buildStrategy({
        accounts,
        blacklist: deadBlacklist,
        alerts: alerts as unknown as AlertService,
      });
    });
    afterAll(() => {
      deadRedis.disconnect();
    });

    it('활성 계정은 DB 값으로 통과하고 경보 1건', async () => {
      const credential = await createAccountCredential(prisma, {
        account_type: 'ADMIN',
        must_change_password: true,
      });

      const result = await fallbackStrategy.validate(
        payload(credential.account_id.toString(), { role: 'USER' }),
      );

      // 폴백은 클레임이 아니라 DB를 믿는다
      expect(result).toEqual({
        accountId: credential.account_id.toString(),
        accountType: 'ADMIN',
        mustChangePassword: true,
      });
      expect(alerts.notify).toHaveBeenCalledTimes(1);
      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          key: 'auth-blacklist-fallback',
        }),
      );
    });

    it('반증: 비밀번호 변경 전에 발급된 토큰은 DB의 password_updated_at으로도 막힌다 — Redis 없이도 자격증명 변경이 새지 않는다', async () => {
      const credential = await createAccountCredential(prisma, {
        account_type: 'SELLER',
      });
      await prisma.accountCredential.update({
        where: { account_id: credential.account_id },
        data: { password_updated_at: new Date(NOW * 1000) },
      });
      const sub = credential.account_id.toString();

      await expect(
        fallbackStrategy.validate(payload(sub, { iat: NOW - 60 })),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
      await expect(
        fallbackStrategy.validate(payload(sub, { iat: NOW })),
      ).resolves.toMatchObject({ accountId: sub });
    });

    // Redis 경로와 같은 입력 표 — 어느 경로를 타든 응답 코드가 같아야 한다
    it.each([
      ['정지', { status: 'SUSPENDED' as const }, 'ACCOUNT_NOT_ACTIVE'],
      ['탈퇴', { deleted_at: new Date(NOW * 1000) }, 'SESSION_ACCOUNT_MISSING'],
    ] as const)(
      '%s 계정은 DB 값으로 막힌다 → %s',
      async (_, overrides, code) => {
        const account = await createAccount(prisma, {
          account_type: 'USER',
          ...overrides,
        });

        await expect(
          fallbackStrategy.validate(payload(account.id.toString())),
        ).rejects.toThrowDomain(code);
      },
    );

    it('연결이 ready가 아니면(재접속 중) 조회를 기다리지 않고 바로 DB로 간다', async () => {
      const mget = jest.fn();
      const reconnecting = buildStrategy({
        accounts,
        blacklist: new TokenBlacklistService(
          { status: 'reconnecting', mget } as unknown as Redis,
          { getOrThrow: () => TEST_AUTH_CONFIG } as unknown as ConfigService,
          alerts as unknown as AlertService,
          clock,
        ),
        alerts: alerts as unknown as AlertService,
      });
      const account = await createAccount(prisma, { account_type: 'USER' });

      await expect(
        reconnecting.validate(payload(account.id.toString())),
      ).resolves.toMatchObject({ accountId: account.id.toString() });
      expect(mget).not.toHaveBeenCalled();
      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'auth-blacklist-fallback' }),
      );
    });

    it('없는 계정은 SESSION_ACCOUNT_MISSING', async () => {
      await expect(
        fallbackStrategy.validate(payload('99999')),
      ).rejects.toThrowDomain('SESSION_ACCOUNT_MISSING');
    });
  });
});
