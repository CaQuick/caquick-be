import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { sha256Hex } from '@/common/utils/crypto';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { TokenService } from '@/features/auth/services/token.service';
import { REFRESH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import { TEST_AUTH_CONFIG, testAuthConfig } from '@/test/auth-config';

describe('TokenService', () => {
  let service: TokenService;
  let config: jest.Mocked<ConfigService>;
  let jwt: jest.Mocked<JwtService>;
  let refreshSessions: jest.Mocked<IRefreshSessionRepository>;
  let accounts: jest.Mocked<Pick<IAccountRepository, 'findAccountForJwt'>>;

  const mockReq = {
    headers: { 'user-agent': 'Mozilla/5.0 TokenSpec' },
    ip: '127.0.0.1',
    cookies: {},
  } as unknown as Request;

  const mockRes = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    config = {
      get: jest.fn(),
      // 소비처는 raw env가 아니라 authConfig 네임스페이스를 읽는다
      getOrThrow: jest.fn(() => TEST_AUTH_CONFIG),
    } as unknown as jest.Mocked<ConfigService>;

    jwt = {
      sign: jest.fn(() => 'signed-token'),
    } as unknown as jest.Mocked<JwtService>;

    refreshSessions = {
      createRefreshSession: jest.fn(),
      findActiveRefreshSessionByHash: jest.fn(),
      rotateRefreshSession: jest.fn(),
      revokeRefreshSession: jest.fn(),
      revokeAllRefreshSessions: jest.fn(),
    };

    accounts = {
      findAccountForJwt: jest.fn().mockResolvedValue({
        id: BigInt(1),
        status: 'ACTIVE',
        account_type: 'USER',
        credential: null,
        store: null,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
        {
          provide: REFRESH_SESSION_REPOSITORY,
          useValue: refreshSessions,
        },
        { provide: ACCOUNT_REPOSITORY, useValue: accounts },
      ],
    }).compile();

    service = module.get(TokenService);
    (mockRes.cookie as jest.Mock).mockClear();
    (mockRes.clearCookie as jest.Mock).mockClear();
  });

  describe('signAccessToken', () => {
    it('신원 클레임(sub·typ·role·mustChangePassword·cv)만 서명한다 — 시간·발급자는 서명 옵션 몫', () => {
      const result = service.signAccessToken(
        {
          id: BigInt(42),
          status: 'ACTIVE',
          account_type: 'USER',
          credential: null,
          store: null,
        },
        null,
      );

      expect(result).toBe('signed-token');
      expect(jwt.sign).toHaveBeenCalledTimes(1);
      expect(jwt.sign).toHaveBeenCalledWith({
        sub: '42',
        typ: 'access',
        role: 'USER',
        mustChangePassword: false,
        cv: 0,
      });
    });

    it('판매자는 storeId를, 비밀번호 변경 대상은 플래그를 클레임에 담는다', () => {
      service.signAccessToken(
        {
          id: BigInt(7),
          status: 'ACTIVE',
          account_type: 'SELLER',
          credential: { must_change_password: true, password_updated_at: null },
          store: { id: BigInt(3) },
        },
        null,
      );

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: '7',
        typ: 'access',
        role: 'SELLER',
        mustChangePassword: true,
        storeId: '3',
        cv: 0,
      });
    });

    it('cv는 넘겨받은 버전(ms)이다 — 계정 행의 password_updated_at을 다시 쓰지 않는다', () => {
      const verified = new Date('2026-10-04T00:00:00.123Z');

      service.signAccessToken(
        {
          id: BigInt(7),
          status: 'ACTIVE',
          account_type: 'SELLER',
          credential: {
            must_change_password: false,
            password_updated_at: new Date('2026-10-04T00:00:01.000Z'),
          },
          store: null,
        },
        verified,
      );

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ cv: verified.getTime() }),
      );
    });
  });

  describe('getAccessExpiresSeconds', () => {
    it('기본값 900', () => {
      config.get.mockReturnValue(undefined);
      expect(service.getAccessExpiresSeconds()).toBe(900);
    });

    it('설정값(authConfig)을 그대로 쓴다', () => {
      config.getOrThrow.mockReturnValue(
        testAuthConfig({ jwtAccessExpiresSeconds: 300 }),
      );
      expect(service.getAccessExpiresSeconds()).toBe(300);
    });
  });

  describe('sha256Hex', () => {
    it('알려진 입력에 대해 안정적인 hex 값을 반환한다', () => {
      const a = service.sha256Hex('hello');
      const b = service.sha256Hex('hello');
      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    });
  });

  describe('issueAuthTokens', () => {
    it('refresh session 을 저장하고 access token + refresh 쿠키를 발급한다', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_EXPIRES_SECONDS') return '900';
        if (key === 'AUTH_REFRESH_EXPIRES_DAYS') return '30';
        if (key === 'AUTH_COOKIE_DOMAIN') return undefined;
        if (key === 'AUTH_COOKIE_SECURE') return 'false';
        return undefined;
      });

      const result = await service.issueAuthTokens({
        accountId: BigInt(1),
        credentialVersion: null,
        req: mockReq,
        res: mockRes,
      });

      expect(result).toEqual({ accessToken: 'signed-token' });
      expect(refreshSessions.createRefreshSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: BigInt(1),
          userAgent: 'Mozilla/5.0 TokenSpec',
          ipAddress: '127.0.0.1',
          credentialVersion: null,
        }),
      );
      expect(mockRes.cookie).toHaveBeenCalledTimes(1);
    });

    it('쿠키 전달(기본)은 반환에 refreshToken·refreshExpiresAt 키가 없다', async () => {
      const result = await service.issueAuthTokens({
        accountId: BigInt(1),
        credentialVersion: null,
        req: mockReq,
        res: mockRes,
        transport: 'cookie',
      });

      expect(result).not.toHaveProperty('refreshToken');
      expect(result).not.toHaveProperty('refreshExpiresAt');
      expect(mockRes.cookie).toHaveBeenCalledTimes(1);
    });

    it('바디 전달은 쿠키를 굽지 않고 저장 해시와 맞는 refreshToken·세션 만료와 같은 refreshExpiresAt을 반환한다', async () => {
      const result = await service.issueAuthTokens({
        accountId: BigInt(1),
        credentialVersion: null,
        req: mockReq,
        res: mockRes,
        transport: 'body',
      });

      expect(mockRes.cookie).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      const created = refreshSessions.createRefreshSession.mock.calls[0][0];
      expect(created.tokenHash).toBe(sha256Hex(result.refreshToken!));
      expect(result.refreshExpiresAt).toEqual(created.expiresAt);
    });
  });

  describe('rotateRefresh', () => {
    it('refresh 쿠키가 없으면 UnauthorizedException(Missing)', async () => {
      const reqNoCookie = { cookies: {} } as unknown as Request;

      await expect(
        service.rotateRefresh('USER', reqNoCookie, mockRes),
      ).rejects.toThrowDomain(401);
      await expect(
        service.rotateRefresh('USER', reqNoCookie, mockRes),
      ).rejects.toThrowDomain('MISSING_REFRESH_TOKEN');
    });

    it('활성 세션이 없으면 UnauthorizedException(Invalid)', async () => {
      const reqWithCookie = {
        cookies: { caquick_rt: 'raw-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(null);

      await expect(
        service.rotateRefresh('USER', reqWithCookie, mockRes),
      ).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
    });

    it('정상 회전 시 새 access + accountId 를 반환하고 새 refresh 쿠키를 발급한다', async () => {
      const reqWithCookie = {
        cookies: { caquick_rt: 'raw-token' },
        headers: { 'user-agent': 'ua' },
        ip: '1.2.3.4',
      } as unknown as Request;

      config.get.mockImplementation((key: string) => {
        if (key === 'AUTH_REFRESH_EXPIRES_DAYS') return '30';
        if (key === 'AUTH_COOKIE_SECURE') return 'false';
        return undefined;
      });

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(7),
        account_id: BigInt(10),
        credential_version: null,
      } as never);

      refreshSessions.rotateRefreshSession.mockResolvedValue({} as never);

      const result = await service.rotateRefresh(
        'USER',
        reqWithCookie,
        mockRes,
      );

      expect(result.accountId).toBe(BigInt(10));
      expect(result.accessToken).toBe('signed-token');
      expect(refreshSessions.rotateRefreshSession).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSessionId: BigInt(7),
          accountId: BigInt(10),
          credentialVersion: null,
        }),
      );
      expect(mockRes.cookie).toHaveBeenCalledTimes(1);
    });
  });

  describe('rotateRefresh — 바디 모드', () => {
    const BODY_TOKEN = 'b'.repeat(64);
    const COOKIE_TOKEN = 'c'.repeat(64);
    const sellerAccount = {
      id: BigInt(10),
      status: 'ACTIVE',
      account_type: 'SELLER',
      credential: { must_change_password: false, password_updated_at: null },
      store: null,
    } as never;

    beforeEach(() => {
      accounts.findAccountForJwt.mockResolvedValue(sellerAccount);
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(7),
        account_id: BigInt(10),
        credential_version: null,
      } as never);
      refreshSessions.rotateRefreshSession.mockResolvedValue({} as never);
    });

    it('바디 토큰으로 회전하면 쿠키를 굽지 않고 새 refreshToken·refreshExpiresAt을 반환한다', async () => {
      const req = {
        body: { refreshToken: BODY_TOKEN },
        cookies: {},
        headers: {},
      } as unknown as Request;

      const result = await service.rotateRefresh('SELLER', req, mockRes);

      expect(
        refreshSessions.findActiveRefreshSessionByHash,
      ).toHaveBeenCalledWith(sha256Hex(BODY_TOKEN));
      expect(mockRes.cookie).not.toHaveBeenCalled();
      expect(result.accountId).toBe(BigInt(10));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.refreshToken).not.toBe(BODY_TOKEN);
      const rotated = refreshSessions.rotateRefreshSession.mock.calls[0][0];
      expect(rotated.newTokenHash).toBe(sha256Hex(result.refreshToken!));
      expect(result.refreshExpiresAt).toEqual(rotated.newExpiresAt);
    });

    it('바디와 쿠키가 함께 오면 바디 세션만 회전한다 — 쿠키는 읽지도 굽지도 않는다', async () => {
      const req = {
        body: { refreshToken: BODY_TOKEN },
        cookies: { [REFRESH_COOKIE.SELLER]: COOKIE_TOKEN },
        headers: {},
      } as unknown as Request;

      await service.rotateRefresh('SELLER', req, mockRes);

      expect(
        refreshSessions.findActiveRefreshSessionByHash,
      ).toHaveBeenCalledTimes(1);
      expect(
        refreshSessions.findActiveRefreshSessionByHash,
      ).toHaveBeenCalledWith(sha256Hex(BODY_TOKEN));
      expect(mockRes.cookie).not.toHaveBeenCalled();
    });

    it('쿠키 모드 회전은 반환에 refreshToken 키가 없다', async () => {
      const req = {
        body: {},
        cookies: { [REFRESH_COOKIE.SELLER]: COOKIE_TOKEN },
        headers: {},
      } as unknown as Request;

      const result = await service.rotateRefresh('SELLER', req, mockRes);

      expect(result).not.toHaveProperty('refreshToken');
      expect(mockRes.cookie).toHaveBeenCalledTimes(1);
    });

    it.each(['USER', 'ADMIN'] as const)(
      '%s는 바디 토큰을 무시한다 — 쿠키가 없으면 MISSING_REFRESH_TOKEN',
      async (role) => {
        const req = {
          body: { refreshToken: BODY_TOKEN },
          cookies: {},
          headers: {},
        } as unknown as Request;

        await expect(
          service.rotateRefresh(role, req, mockRes),
        ).rejects.toThrowDomain('MISSING_REFRESH_TOKEN');
        expect(
          refreshSessions.findActiveRefreshSessionByHash,
        ).not.toHaveBeenCalled();
      },
    );
  });

  describe('clearRefreshCookie', () => {
    it('refresh 쿠키를 삭제한다', () => {
      config.get.mockReturnValue(undefined);
      service.clearRefreshCookie('USER', mockRes);
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(1);
    });
  });
});
