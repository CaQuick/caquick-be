import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import { sha256Hex } from '@/common/utils/crypto';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AuthService } from '@/features/auth/auth.service';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AccountCredentialRepository } from '@/features/auth/repositories/account-credential.repository';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from '@/features/auth/repositories/account-credential.repository.interface';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import { REFRESH_SESSION_REPOSITORY } from '@/features/auth/repositories/refresh-session.repository.interface';
import { AdminAccountService } from '@/features/auth/services/auth-admin-account.service';
import {
  CredentialAuthService,
  type CredentialRole,
} from '@/features/auth/services/credential-auth.service';
import { TokenService } from '@/features/auth/services/token.service';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { AdminSellerService } from '@/features/store/services/store-admin-seller.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import type { AccessTokenPayload } from '@/global/auth';
import {
  BLACKLIST_READY_KEY,
  TokenBlacklistService,
} from '@/global/auth/blacklist/token-blacklist.service';
import { REFRESH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { redisTestProviders } from '@/test/redis';

const PASSWORD = 'Current!Pass1';
const NEW_PASSWORD = 'Changed!Pass2';

const jwt = new JwtService({
  privateKey: TEST_AUTH_CONFIG.jwtKeys.privateKeyPem,
  publicKey: TEST_AUTH_CONFIG.jwtKeys.publicKeyPem,
  signOptions: {
    algorithm: 'RS256',
    issuer: TEST_AUTH_CONFIG.jwtIssuer,
    audience: TEST_AUTH_CONFIG.jwtAudience,
    keyid: TEST_AUTH_CONFIG.jwtKeys.kid,
    expiresIn: TEST_AUTH_CONFIG.jwtAccessExpiresSeconds,
  },
});

// 비밀번호 변경과 겹친 발급: 변경 트랜잭션(교체 + 전 세션 폐기)이 커밋된 뒤에 만들어진 세션·토큰은 폐기를 비껴간다
describe('자격증명 버전 — 비밀번호 변경과 겹친 로그인·회전 (real DB + real Redis)', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let credentialAuth: CredentialAuthService;
  let auth: AuthService;
  let tokens: TokenService;
  let credentials: AccountCredentialRepository;
  let refreshSessions: RefreshSessionRepository;
  let blacklist: TokenBlacklistService;
  let adminAccounts: AdminAccountService;
  let adminSellers: AdminSellerService;
  let strategy: JwtBearerStrategy;
  let passwordHash: string;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };

  beforeAll(async () => {
    redis = await connectTestRedis();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        CredentialAuthService,
        AuthService,
        TokenService,
        AdminAccountService,
        AdminSellerService,
        StoreSellerRepository,
        AccountAdminRepository,
        TokenBlacklistService,
        ClockService,
        { provide: ACCOUNT_REPOSITORY, useClass: AccountRepository },
        {
          provide: ACCOUNT_CREDENTIAL_REPOSITORY,
          useClass: AccountCredentialRepository,
        },
        {
          provide: REFRESH_SESSION_REPOSITORY,
          useClass: RefreshSessionRepository,
        },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AlertService, useValue: alerts },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
        ...redisTestProviders(redis),
      ],
    });
    prisma = p;
    credentialAuth = module.get(CredentialAuthService);
    auth = module.get(AuthService);
    tokens = module.get(TokenService);
    credentials = module.get(ACCOUNT_CREDENTIAL_REPOSITORY);
    refreshSessions = module.get(REFRESH_SESSION_REPOSITORY);
    blacklist = module.get(TokenBlacklistService);
    adminAccounts = module.get(AdminAccountService);
    adminSellers = module.get(AdminSellerService);
    // Passport Strategy는 생성자에서 super()를 부르므로 validate만 쓰기 위해 prototype에서 만든다
    strategy = Object.assign(Object.create(JwtBearerStrategy.prototype), {
      accounts: module.get(ACCOUNT_REPOSITORY),
      blacklist,
      alerts,
    }) as JwtBearerStrategy;
    passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  });

  afterAll(async () => {
    await redis.quit();
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    await redis.flushdb();
    await blacklist.markReady(await blacklist.generation());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function jar() {
    const set: Record<string, string> = {};
    const res = {
      cookie: (name: string, value: string) => {
        set[name] = value;
      },
    } as unknown as Response;
    return { res, set };
  }

  function reqWith(cookies: Record<string, string> = {}): Request {
    return { cookies, headers: {}, ip: '127.0.0.1' } as unknown as Request;
  }

  async function login(role: CredentialRole, username: string) {
    const { res, set } = jar();
    const { accessToken } = await credentialAuth.login({
      role,
      username,
      password: PASSWORD,
      req: reqWith(),
      res,
    });
    return { accessToken, refreshToken: set[REFRESH_COOKIE[role]] };
  }

  async function refresh(role: CredentialRole, refreshToken: string) {
    const { res, set } = jar();
    const { accessToken } = await credentialAuth.refresh({
      role,
      req: reqWith({ [REFRESH_COOKIE[role]]: refreshToken }),
      res,
    });
    return { accessToken, refreshToken: set[REFRESH_COOKIE[role]] };
  }

  function sessionOf(refreshToken: string) {
    return prisma.authRefreshSession.findFirstOrThrow({
      where: { token_hash: sha256Hex(refreshToken) },
    });
  }

  /** Redis 경로(표식 있음)와 DB 폴백(표식 없음) 둘 다에서 같은 판정이어야 한다. */
  async function expectAccessToken(accessToken: string, blocked: boolean) {
    const payload = jwt.verify<AccessTokenPayload>(accessToken);
    for (const path of ['redis', 'db'] as const) {
      if (path === 'db') await redis.del(BLACKLIST_READY_KEY);
      const result = strategy.validate(payload);
      if (blocked) {
        await expect(result).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
      } else {
        await expect(result).resolves.toMatchObject({ accountId: payload.sub });
      }
    }
    await blacklist.markReady(await blacklist.generation());
  }

  async function makeCredential(role: CredentialRole) {
    return createAccountCredential(prisma, {
      account_type: role,
      password_hash: passwordHash,
    });
  }

  async function adminActor(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  // 비밀번호를 바꾸는 세 경로 — 모두 교체·전 세션 폐기를 한 트랜잭션으로 하고 커밋 뒤 블랙리스트에 등록한다
  const CHANGES: Array<
    [string, CredentialRole, (accountId: bigint) => Promise<unknown>]
  > = [
    [
      '본인 변경',
      'SELLER',
      (accountId) =>
        credentialAuth.changePassword({
          role: 'SELLER',
          accountId,
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          req: reqWith(),
        }),
    ],
    [
      '관리자 비밀번호 초기화',
      'ADMIN',
      async (accountId) =>
        adminAccounts.adminResetAdminPassword(await adminActor(), {
          accountId: accountId.toString(),
          newPassword: NEW_PASSWORD,
        }),
    ],
    [
      '판매자 비밀번호 초기화',
      'SELLER',
      async (accountId) =>
        adminSellers.adminResetSellerPassword(await adminActor(), {
          accountId: accountId.toString(),
          newPassword: NEW_PASSWORD,
        }),
    ],
  ];

  describe('로그인 — 비밀번호 검증과 발급 사이에 변경이 커밋된다', () => {
    it.each(CHANGES)(
      '%s: 그 로그인의 액세스 토큰은 막히고 세션은 refresh에서 폐기된다',
      async (_, role, change) => {
        const credential = await makeCredential(role);
        const updateLastLogin = credentials.updateLastLogin.bind(credentials);
        jest
          .spyOn(credentials, 'updateLastLogin')
          .mockImplementationOnce(async (accountId, now) => {
            await change(accountId);
            return updateLastLogin(accountId, now);
          });

        const issued = await login(role, credential.username);

        // 변경의 전 세션 폐기를 비껴간 세션이 생겼다 — 경쟁이 재현됐다
        expect((await sessionOf(issued.refreshToken)).revoked_at).toBeNull();
        await expectAccessToken(issued.accessToken, true);
        await expect(refresh(role, issued.refreshToken)).rejects.toThrowDomain(
          'INVALID_REFRESH_TOKEN',
        );
        expect(
          (await sessionOf(issued.refreshToken)).revoked_at,
        ).not.toBeNull();
      },
    );
  });

  describe('refresh 회전 — 세션 확인과 회전 사이에 변경이 커밋된다', () => {
    it.each(CHANGES)(
      '%s: 회전으로 받은 액세스 토큰은 막히고 새 세션은 다음 refresh에서 폐기된다',
      async (_, role, change) => {
        const credential = await makeCredential(role);
        const first = await login(role, credential.username);
        const rotate =
          refreshSessions.rotateRefreshSession.bind(refreshSessions);
        jest
          .spyOn(refreshSessions, 'rotateRefreshSession')
          .mockImplementationOnce(async (args) => {
            await change(credential.account_id);
            return rotate(args);
          });

        const rotated = await refresh(role, first.refreshToken);

        expect((await sessionOf(rotated.refreshToken)).revoked_at).toBeNull();
        await expectAccessToken(rotated.accessToken, true);
        await expect(refresh(role, rotated.refreshToken)).rejects.toThrowDomain(
          'INVALID_REFRESH_TOKEN',
        );
        expect(
          (await sessionOf(rotated.refreshToken)).revoked_at,
        ).not.toBeNull();
      },
    );
  });

  describe('변경과 겹치지 않으면 그대로', () => {
    it('변경 이력이 있는 계정도 로그인·연속 회전이 통과하고 세션이 같은 버전을 이어받는다', async () => {
      const credential = await makeCredential('SELLER');
      const changedAt = new Date('2026-10-01T00:00:00.123Z');
      await prisma.accountCredential.update({
        where: { account_id: credential.account_id },
        data: { password_updated_at: changedAt },
      });
      await blacklist.blockCredentials(credential.account_id, changedAt);

      const first = await login('SELLER', credential.username);
      const second = await refresh('SELLER', first.refreshToken);
      const third = await refresh('SELLER', second.refreshToken);

      expect((await sessionOf(third.refreshToken)).credential_version).toEqual(
        changedAt,
      );
      for (const { accessToken } of [first, second, third]) {
        await expectAccessToken(accessToken, false);
      }
    });

    it.each(CHANGES)(
      '%s 뒤 새 비밀번호로 로그인한 세션·토큰은 통과한다',
      async (_, role, change) => {
        const credential = await makeCredential(role);
        await change(credential.account_id);

        const { res, set } = jar();
        const { accessToken } = await credentialAuth.login({
          role,
          username: credential.username,
          password: NEW_PASSWORD,
          req: reqWith(),
          res,
        });
        const rotated = await refresh(role, set[REFRESH_COOKIE[role]]);

        await expectAccessToken(accessToken, false);
        await expectAccessToken(rotated.accessToken, false);
      },
    );

    it('구매자(OIDC) 세션은 자격증명이 없어(버전 null) 회전이 이어지고 토큰 cv는 0이다', async () => {
      const buyer = await createAccount(prisma, { account_type: 'USER' });
      const { res, set } = jar();
      // OIDC 콜백이 부르는 발급과 같은 인자
      await tokens.issueAuthTokens({
        accountId: buyer.id,
        credentialVersion: null,
        req: reqWith(),
        res,
      });

      let refreshToken = set[REFRESH_COOKIE.USER];
      for (let i = 0; i < 2; i++) {
        const next = jar();
        const { accessToken } = await auth.refresh(
          reqWith({ [REFRESH_COOKIE.USER]: refreshToken }),
          next.res,
        );
        refreshToken = next.set[REFRESH_COOKIE.USER];
        expect(jwt.verify<AccessTokenPayload>(accessToken).cv).toBe(0);
        await expectAccessToken(accessToken, false);
      }
      expect((await sessionOf(refreshToken)).credential_version).toBeNull();
    });
  });

  // 마이그레이션은 버전을 백필하지 않는다 — 기존 세션은 null로 남는다
  describe('버전 기록 전에 발급된 세션', () => {
    it.each([
      ['비밀번호를 바꾼 적 없는 계정은 이어진다', null, false],
      [
        '비밀번호를 바꾼 적 있는 계정은 폐기·거절된다',
        new Date('2026-10-01T00:00:00.123Z'),
        true,
      ],
    ])('%s', async (_, changedAt, rejected) => {
      const credential = await makeCredential('SELLER');
      const issued = await login('SELLER', credential.username);
      await prisma.authRefreshSession.updateMany({
        data: { credential_version: null },
      });
      await prisma.accountCredential.update({
        where: { account_id: credential.account_id },
        data: { password_updated_at: changedAt },
      });

      const result = refresh('SELLER', issued.refreshToken);

      if (rejected) {
        await expect(result).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
        expect(
          (await sessionOf(issued.refreshToken)).revoked_at,
        ).not.toBeNull();
      } else {
        await expect(result).resolves.toMatchObject({
          accessToken: expect.any(String),
        });
      }
    });
  });
});
