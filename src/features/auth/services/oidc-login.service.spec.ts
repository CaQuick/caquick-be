import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { TokenService } from '@/features/auth/services/token.service';
import { TOKEN_SERVICE } from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

describe('OidcLoginService', () => {
  let service: OidcLoginService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockOidc: jest.Mocked<OidcClientService>;
  let mockAccounts: jest.Mocked<IAccountRepository>;
  let mockRefreshSessions: jest.Mocked<IRefreshSessionRepository>;
  let mockJwt: jest.Mocked<JwtService>;

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    mockOidc = {
      buildAuthorizationUrl: jest.fn(),
      exchangeCode: jest.fn(),
      toIdentityProvider: jest.fn(),
    } as unknown as jest.Mocked<OidcClientService>;

    mockAccounts = {
      findIdentityByProviderSubject: jest.fn(),
      findAccountByEmail: jest.fn(),
      upsertUserByOidcIdentity: jest.fn(),
      findAccountForJwt: jest.fn(),
      findAccountForMe: jest.fn(),
    };

    mockRefreshSessions = {
      findActiveRefreshSessionByHash: jest.fn(),
      rotateRefreshSession: jest.fn(),
      revokeRefreshSession: jest.fn(),
      revokeAllRefreshSessions: jest.fn(),
      createRefreshSession: jest.fn(),
    };

    mockJwt = {
      sign: jest.fn(() => 'mock-access-token'),
    } as unknown as jest.Mocked<JwtService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcLoginService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
        { provide: OidcClientService, useValue: mockOidc },
        {
          provide: TOKEN_SERVICE,
          useClass: TokenService,
        },
        {
          provide: ACCOUNT_REPOSITORY,
          useValue: mockAccounts,
        },
        {
          provide: REFRESH_SESSION_REPOSITORY,
          useValue: mockRefreshSessions,
        },
      ],
    }).compile();

    service = module.get(OidcLoginService);
  });

  describe('startOidcLogin', () => {
    it('OIDC 로그인 URL을 생성하고 임시 쿠키를 설정해야 한다', async () => {
      const mockRes = { cookie: jest.fn() } as unknown as Response;

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'FRONTEND_BASE_URL') return 'http://localhost:3000';
        if (key === 'AUTH_COOKIE_DOMAIN') return undefined;
        if (key === 'AUTH_COOKIE_SECURE') return 'false';
        return undefined;
      });

      mockOidc.buildAuthorizationUrl.mockResolvedValue({
        authorizationUrl: 'https://accounts.google.com/auth',
        state: 'mock-state',
        nonce: 'mock-nonce',
        codeVerifier: 'mock-verifier',
      });

      const result = await service.startOidcLogin(
        'google',
        'http://localhost:3000/dashboard',
        mockRes,
      );

      expect(result).toEqual({
        redirectUrl: 'https://accounts.google.com/auth',
      });
      expect(mockOidc.buildAuthorizationUrl).toHaveBeenCalledWith('google');
      expect(mockRes.cookie).toHaveBeenCalledTimes(4);
    });

    it('returnTo가 허용되지 않은 도메인이면 기본값을 사용해야 한다', async () => {
      const mockRes = { cookie: jest.fn() } as unknown as Response;

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'FRONTEND_BASE_URL') return 'http://localhost:3000';
        return undefined;
      });

      mockOidc.buildAuthorizationUrl.mockResolvedValue({
        authorizationUrl: 'https://accounts.google.com/auth',
        state: 'state',
        nonce: 'nonce',
        codeVerifier: 'verifier',
      });

      await service.startOidcLogin('google', 'https://malicious.com', mockRes);

      const returnToCookie = (mockRes.cookie as jest.Mock).mock.calls.find(
        (call) => call[0] === 'caquick_oidc_return_to',
      );
      expect(returnToCookie).toBeDefined();
      expect(returnToCookie![1]).toBe('http://localhost:3000');
    });

    it('returnTo가 undefined이면 기본 프론트 URL을 사용한다', async () => {
      const mockRes = { cookie: jest.fn() } as unknown as Response;
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'FRONTEND_BASE_URL') return 'http://front.example';
        return undefined;
      });
      mockOidc.buildAuthorizationUrl.mockResolvedValue({
        authorizationUrl: 'https://a',
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });

      await service.startOidcLogin('google', undefined, mockRes);

      const returnToCookie = (mockRes.cookie as jest.Mock).mock.calls.find(
        (c) => c[0] === 'caquick_oidc_return_to',
      );
      expect(returnToCookie![1]).toBe('http://front.example');
    });

    it('FRONTEND_BASE_URL이 미설정이면 http://localhost:3000으로 fallback', async () => {
      const mockRes = { cookie: jest.fn() } as unknown as Response;
      mockConfig.get.mockImplementation(() => undefined);
      mockOidc.buildAuthorizationUrl.mockResolvedValue({
        authorizationUrl: 'https://a',
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
      });

      await service.startOidcLogin('google', '   ', mockRes);

      const returnToCookie = (mockRes.cookie as jest.Mock).mock.calls.find(
        (c) => c[0] === 'caquick_oidc_return_to',
      );
      expect(returnToCookie![1]).toBe('http://localhost:3000');
    });
  });

  describe('handleOidcCallback', () => {
    it('OIDC 콜백을 성공적으로 처리하고 인증 쿠키를 발급해야 한다', async () => {
      const mockReq = {
        cookies: {
          caquick_oidc_state: 'expected-state',
          caquick_oidc_nonce: 'expected-nonce',
          caquick_oidc_cv: 'expected-verifier',
          caquick_oidc_return_to: 'http://localhost:3000/dashboard',
        },
        query: {
          code: 'auth-code',
          state: 'expected-state',
        },
        headers: {
          'user-agent': 'Mozilla/5.0',
        },
        ip: '127.0.0.1',
      } as unknown as Request;

      const mockRes = {
        cookie: jest.fn(),
        clearCookie: jest.fn(),
      } as unknown as Response;

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'BACKEND_BASE_URL') return 'http://localhost:4000';
        if (key === 'JWT_ACCESS_EXPIRES_SECONDS') return '900';
        if (key === 'AUTH_REFRESH_EXPIRES_DAYS') return '30';
        if (key === 'AUTH_COOKIE_DOMAIN') return undefined;
        if (key === 'AUTH_COOKIE_SECURE') return 'false';
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      mockOidc.exchangeCode.mockResolvedValue({
        claims: () => ({
          sub: 'google-user-123',
          email: 'test@example.com',
          email_verified: true,
          name: 'Test User',
          picture: 'https://example.com/photo.jpg',
        }),
      } as never);

      mockOidc.toIdentityProvider.mockReturnValue('GOOGLE');

      mockAccounts.upsertUserByOidcIdentity.mockResolvedValue({
        account: {
          id: BigInt(1),
          email: 'test@example.com',
          name: 'Test User',
        } as never,
      });

      mockRefreshSessions.createRefreshSession.mockResolvedValue({} as never);

      const result = await service.handleOidcCallback(
        'google',
        mockReq,
        mockRes,
      );

      expect(result).toEqual({
        returnTo: 'http://localhost:3000/dashboard',
        accessToken: 'mock-access-token',
      });
      expect(mockOidc.exchangeCode).toHaveBeenCalled();
      expect(mockAccounts.upsertUserByOidcIdentity).toHaveBeenCalledWith({
        provider: 'GOOGLE',
        providerSubject: 'google-user-123',
        providerEmail: 'test@example.com',
        emailVerified: true,
        providerDisplayName: 'Test User',
        providerProfileImageUrl: 'https://example.com/photo.jpg',
      });
      expect(mockRes.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.REFRESH,
        expect.any(String),
        expect.any(Object),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(4);
    });

    it('OIDC 세션 쿠키가 없으면 UnauthorizedException을 던져야 한다', async () => {
      const mockReq = { cookies: {} } as unknown as Request;
      const mockRes = {} as Response;

      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow('OIDC session is missing.');
    });

    it('OIDC subject가 없으면 UnauthorizedException을 던져야 한다', async () => {
      const mockReq = {
        cookies: {
          caquick_oidc_state: 'state',
          caquick_oidc_nonce: 'nonce',
          caquick_oidc_cv: 'verifier',
        },
        query: { code: 'code', state: 'state' },
        headers: {},
      } as unknown as Request;

      const mockRes = {} as Response;

      mockConfig.get.mockReturnValue('http://localhost:4000');

      mockOidc.exchangeCode.mockResolvedValue({
        claims: () => ({}),
      } as never);

      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow('OIDC subject is missing.');
    });

    it('upsertUserByOidcIdentity가 account=null을 반환하면 UnauthorizedException', async () => {
      const mockReq = {
        cookies: {
          caquick_oidc_state: 'state',
          caquick_oidc_nonce: 'nonce',
          caquick_oidc_cv: 'verifier',
        },
        query: { code: 'code', state: 'state' },
        headers: {},
      } as unknown as Request;
      const mockRes = {} as Response;

      mockConfig.get.mockReturnValue('http://localhost:4000');
      mockOidc.exchangeCode.mockResolvedValue({
        claims: () => ({ sub: 'sub' }),
      } as never);
      mockOidc.toIdentityProvider.mockReturnValue('GOOGLE');
      mockAccounts.upsertUserByOidcIdentity.mockResolvedValue({
        account: null,
      });

      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow('Account upsert failed.');
    });
  });
});
