import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import { sha256Hex } from '@/common/utils/crypto';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AuthService } from '@/features/auth/auth.service';
import { AccountCredentialRepository } from '@/features/auth/repositories/account-credential.repository';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from '@/features/auth/repositories/account-credential.repository.interface';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import { REFRESH_SESSION_REPOSITORY } from '@/features/auth/repositories/refresh-session.repository.interface';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { TokenService } from '@/features/auth/services/token.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { type AccountRole, TokenBlacklistService } from '@/global/auth';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 이름은 리터럴로 고정한다 — 운영 쿠키 이름이 바뀌면 전 세션이 끊긴다
const COOKIE: Record<AccountRole, string> = {
  USER: 'caquick_rt',
  SELLER: 'caquick_seller_rt',
  ADMIN: 'caquick_admin_rt',
};
const ROLES = ['USER', 'SELLER', 'ADMIN'] as const;
const CROSS = ROLES.flatMap((route) =>
  ROLES.filter((owner) => owner !== route).map(
    (owner): [AccountRole, AccountRole] => [route, owner],
  ),
);

describe('역할별 refresh 쿠키 (real DB)', () => {
  let prisma: PrismaClient;
  let tokens: TokenService;
  let auth: AuthService;
  let credentialAuth: CredentialAuthService;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AuthService,
        CredentialAuthService,
        TokenService,
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
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
        { provide: JwtService, useValue: { sign: () => 'access-token' } },
        // refresh·logout 경로는 블랙리스트를 쓰지 않는다
        { provide: TokenBlacklistService, useValue: {} },
      ],
    });
    prisma = p;
    tokens = module.get(TokenService);
    auth = module.get(AuthService);
    credentialAuth = module.get(CredentialAuthService);
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  function jar() {
    const set: Record<string, string> = {};
    const cleared: string[] = [];
    const res = {
      cookie: (name: string, value: string) => {
        set[name] = value;
      },
      clearCookie: (name: string) => {
        cleared.push(name);
      },
    } as unknown as Response;
    return { res, set, cleared };
  }

  function reqWith(cookies: Record<string, string>): Request {
    return { cookies, headers: {}, ip: '127.0.0.1' } as unknown as Request;
  }

  /** 로그인 경로가 굽는 것과 같은 issueAuthTokens로 세션을 만든다. */
  async function login(role: AccountRole) {
    const accountId =
      role === 'USER'
        ? (await createAccount(prisma, { account_type: 'USER' })).id
        : (await createAccountCredential(prisma, { account_type: role }))
            .account_id;
    const { res, set } = jar();
    await tokens.issueAuthTokens({ accountId, req: reqWith({}), res });
    const raw = Object.values(set)[0];
    const session = await prisma.authRefreshSession.findFirstOrThrow({
      where: { token_hash: sha256Hex(raw) },
    });
    return { raw, sessionId: session.id, cookieNames: Object.keys(set) };
  }

  function refreshAs(role: AccountRole, req: Request, res: Response) {
    return role === 'USER'
      ? auth.refresh(req, res)
      : credentialAuth.refresh({ role, req, res });
  }

  function logoutAs(role: AccountRole, req: Request, res: Response) {
    return role === 'USER'
      ? auth.logout(req, res)
      : credentialAuth.logout({ role, req, res });
  }

  async function isRevoked(sessionId: bigint): Promise<boolean> {
    const session = await prisma.authRefreshSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    return session.revoked_at !== null;
  }

  describe('역할별 쿠키 이름', () => {
    it.each(ROLES)('%s 로그인은 자기 역할 쿠키만 굽는다', async (role) => {
      const { cookieNames } = await login(role);

      expect(cookieNames).toEqual([COOKIE[role]]);
    });

    it.each(ROLES)('%s 재발급은 자기 역할 쿠키만 굽는다', async (role) => {
      const { raw, sessionId } = await login(role);
      const { res, set } = jar();

      await refreshAs(role, reqWith({ [COOKIE[role]]: raw }), res);

      expect(Object.keys(set)).toEqual([COOKIE[role]]);
      expect(await isRevoked(sessionId)).toBe(true);
    });

    it.each(ROLES)('%s 로그아웃은 자기 역할 쿠키만 지운다', async (role) => {
      const { raw, sessionId } = await login(role);
      const { res, cleared } = jar();

      await logoutAs(role, reqWith({ [COOKIE[role]]: raw }), res);

      expect(cleared).toEqual([COOKIE[role]]);
      expect(await isRevoked(sessionId)).toBe(true);
    });
  });

  describe('다른 역할의 세션', () => {
    it.each(CROSS)(
      '%s 경로는 %s 쿠키만 있으면 그 세션을 읽지 않는다',
      async (route, owner) => {
        const { raw, sessionId } = await login(owner);
        const { res, set } = jar();

        await expect(
          refreshAs(route, reqWith({ [COOKIE[owner]]: raw }), res),
        ).rejects.toThrowDomain('MISSING_REFRESH_TOKEN');
        expect(set).toEqual({});
        expect(await isRevoked(sessionId)).toBe(false);
      },
    );

    // 이름이 나뉘기 전에 구운 caquick_rt에는 관리자·판매자 세션이 들어 있다
    it.each(CROSS)(
      '%s 경로의 쿠키에 %s 세션이 있으면 재발급을 거절하고 세션을 남긴다',
      async (route, owner) => {
        const { raw, sessionId } = await login(owner);
        const { res, set } = jar();

        await expect(
          refreshAs(route, reqWith({ [COOKIE[route]]: raw }), res),
        ).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
        expect(set).toEqual({});
        expect(await isRevoked(sessionId)).toBe(false);
      },
    );

    it.each(CROSS)(
      '%s 경로의 쿠키에 %s 세션이 있으면 로그아웃을 거절하고 세션을 남긴다',
      async (route, owner) => {
        const { raw, sessionId } = await login(owner);
        const { res, cleared } = jar();

        await expect(
          logoutAs(route, reqWith({ [COOKIE[route]]: raw }), res),
        ).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
        expect(cleared).toEqual([]);
        expect(await isRevoked(sessionId)).toBe(false);
      },
    );

    it('관리자 쿠키만 있을 때 구매자 로그아웃은 관리자 세션을 폐기하지 않는다', async () => {
      const admin = await login('ADMIN');
      const { res, cleared } = jar();

      await auth.logout(reqWith({ [COOKIE.ADMIN]: admin.raw }), res);

      expect(cleared).toEqual([COOKIE.USER]);
      expect(await isRevoked(admin.sessionId)).toBe(false);
    });
  });

  it('세 역할 쿠키가 함께 있어도 각자 자기 세션만 회전한다', async () => {
    const sessions = {
      USER: await login('USER'),
      SELLER: await login('SELLER'),
      ADMIN: await login('ADMIN'),
    };
    const cookies = Object.fromEntries(
      ROLES.map((role) => [COOKIE[role], sessions[role].raw]),
    );

    for (const [i, role] of ROLES.entries()) {
      const { res, set } = jar();
      await refreshAs(role, reqWith(cookies), res);

      expect(Object.keys(set)).toEqual([COOKIE[role]]);
      for (const other of ROLES) {
        const rotated = ROLES.indexOf(other) <= i;
        expect(await isRevoked(sessions[other].sessionId)).toBe(rotated);
      }
    }
  });
});
