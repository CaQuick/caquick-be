import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { TokenService } from '@/features/auth/services/token.service';
import { TEST_AUTH_CONFIG, testAuthConfig } from '@/test/auth-config';

describe('TokenService', () => {
  let service: TokenService;
  let config: jest.Mocked<ConfigService>;
  let jwt: jest.Mocked<JwtService>;
  let refreshSessions: jest.Mocked<IRefreshSessionRepository>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
        {
          provide: REFRESH_SESSION_REPOSITORY,
          useValue: refreshSessions,
        },
        {
          provide: ACCOUNT_REPOSITORY,
          useValue: {
            findAccountForJwt: jest.fn().mockResolvedValue({
              id: BigInt(1),
              status: 'ACTIVE',
              account_type: 'USER',
              credential: null,
              store: null,
            }),
          },
        },
      ],
    }).compile();

    service = module.get(TokenService);
    (mockRes.cookie as jest.Mock).mockClear();
    (mockRes.clearCookie as jest.Mock).mockClear();
  });

  describe('signAccessToken', () => {
    it('신원 클레임(sub·typ·role·mustChangePassword)만 서명한다 — 시간·발급자는 서명 옵션 몫', () => {
      const result = service.signAccessToken({
        id: BigInt(42),
        status: 'ACTIVE',
        account_type: 'USER',
        credential: null,
        store: null,
      });

      expect(result).toBe('signed-token');
      expect(jwt.sign).toHaveBeenCalledTimes(1);
      expect(jwt.sign).toHaveBeenCalledWith({
        sub: '42',
        typ: 'access',
        role: 'USER',
        mustChangePassword: false,
      });
    });

    it('판매자는 storeId를, 비밀번호 변경 대상은 플래그를 클레임에 담는다', () => {
      service.signAccessToken({
        id: BigInt(7),
        status: 'ACTIVE',
        account_type: 'SELLER',
        credential: { must_change_password: true, password_updated_at: null },
        store: { id: BigInt(3) },
      });

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: '7',
        typ: 'access',
        role: 'SELLER',
        mustChangePassword: true,
        storeId: '3',
      });
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
        req: mockReq,
        res: mockRes,
      });

      expect(result).toEqual({ accessToken: 'signed-token' });
      expect(refreshSessions.createRefreshSession).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: BigInt(1),
          userAgent: 'Mozilla/5.0 TokenSpec',
          ipAddress: '127.0.0.1',
        }),
      );
      expect(mockRes.cookie).toHaveBeenCalledTimes(1);
    });
  });

  describe('rotateRefresh', () => {
    it('refresh 쿠키가 없으면 UnauthorizedException(Missing)', async () => {
      const reqNoCookie = { cookies: {} } as unknown as Request;

      await expect(
        service.rotateRefresh(reqNoCookie, mockRes),
      ).rejects.toThrowDomain(401);
      await expect(
        service.rotateRefresh(reqNoCookie, mockRes),
      ).rejects.toThrowDomain('MISSING_REFRESH_TOKEN');
    });

    it('활성 세션이 없으면 UnauthorizedException(Invalid)', async () => {
      const reqWithCookie = {
        cookies: { caquick_rt: 'raw-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(null);

      await expect(
        service.rotateRefresh(reqWithCookie, mockRes),
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
      } as never);

      refreshSessions.rotateRefreshSession.mockResolvedValue({} as never);

      const result = await service.rotateRefresh(reqWithCookie, mockRes);

      expect(result.accountId).toBe(BigInt(10));
      expect(result.accessToken).toBe('signed-token');
      expect(refreshSessions.rotateRefreshSession).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSessionId: BigInt(7),
          accountId: BigInt(10),
        }),
      );
      expect(mockRes.cookie).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearRefreshCookie', () => {
    it('refresh 쿠키를 삭제한다', () => {
      config.get.mockReturnValue(undefined);
      service.clearRefreshCookie(mockRes);
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(1);
    });
  });
});
