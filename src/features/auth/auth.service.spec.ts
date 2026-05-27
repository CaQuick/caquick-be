import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuthService } from '@/features/auth/auth.service';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import {
  SELLER_CREDENTIAL_REPOSITORY,
  type ISellerCredentialRepository,
} from '@/features/auth/repositories/seller-credential.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import { TokenService } from '@/features/auth/services/token.service';
import { TOKEN_SERVICE } from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

describe('AuthService', () => {
  let service: AuthService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockJwt: jest.Mocked<JwtService>;
  let mockOidc: jest.Mocked<OidcClientService>;
  let mockAccounts: jest.Mocked<IAccountRepository>;
  let mockSellerCredentials: jest.Mocked<ISellerCredentialRepository>;
  let mockRefreshSessions: jest.Mocked<IRefreshSessionRepository>;
  let mockAuditLogs: jest.Mocked<IAuditLogRepository>;

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    mockJwt = {
      sign: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

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

    mockSellerCredentials = {
      findSellerCredentialByUsername: jest.fn(),
      findSellerCredentialByAccountId: jest.fn(),
      updateSellerLastLogin: jest.fn(),
      updateSellerPasswordHash: jest.fn(),
    };

    mockRefreshSessions = {
      findActiveRefreshSessionByHash: jest.fn(),
      rotateRefreshSession: jest.fn(),
      revokeRefreshSession: jest.fn(),
      revokeAllRefreshSessions: jest.fn(),
      createRefreshSession: jest.fn(),
    };

    mockAuditLogs = {
      createAuditLog: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
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
          provide: SELLER_CREDENTIAL_REPOSITORY,
          useValue: mockSellerCredentials,
        },
        {
          provide: REFRESH_SESSION_REPOSITORY,
          useValue: mockRefreshSessions,
        },
        {
          provide: AUDIT_LOG_REPOSITORY,
          useValue: mockAuditLogs,
        },
        { provide: ClockService, useValue: { now: () => new Date() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('startOidcLogin', () => {
    it('OIDC 로그인 URL을 생성하고 임시 쿠키를 설정해야 한다', async () => {
      // Arrange
      const mockRes = {
        cookie: jest.fn(),
      } as unknown as Response;

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

      // Act
      const result = await service.startOidcLogin(
        'google',
        'http://localhost:3000/dashboard',
        mockRes,
      );

      // Assert
      expect(result).toEqual({
        redirectUrl: 'https://accounts.google.com/auth',
      });
      expect(mockOidc.buildAuthorizationUrl).toHaveBeenCalledWith('google');
      expect(mockRes.cookie).toHaveBeenCalledTimes(4); // state, nonce, codeVerifier, returnTo
    });

    it('returnTo가 허용되지 않은 도메인이면 기본값을 사용해야 한다', async () => {
      // Arrange
      const mockRes = {
        cookie: jest.fn(),
      } as unknown as Response;

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

      // Act
      await service.startOidcLogin('google', 'https://malicious.com', mockRes);

      // Assert
      // returnTo 쿠키가 기본값으로 설정되어야 함
      const returnToCookie = (mockRes.cookie as jest.Mock).mock.calls.find(
        (call) => call[0] === 'caquick_oidc_return_to',
      );
      expect(returnToCookie).toBeDefined();
      expect(returnToCookie![1]).toBe('http://localhost:3000');
    });
  });

  describe('handleOidcCallback', () => {
    it('OIDC 콜백을 성공적으로 처리하고 인증 쿠키를 발급해야 한다', async () => {
      // Arrange
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
      mockJwt.sign.mockReturnValue('mock-access-token');

      // Act
      const result = await service.handleOidcCallback(
        'google',
        mockReq,
        mockRes,
      );

      // Assert
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
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(4); // OIDC 임시 쿠키 4개
    });

    it('OIDC 세션 쿠키가 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const mockRes = {} as Response;

      // Act & Assert
      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow('OIDC session is missing.');
    });

    it('OIDC subject가 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
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
        claims: () => ({}), // sub 없음
      } as never);

      // Act & Assert
      await expect(
        service.handleOidcCallback('google', mockReq, mockRes),
      ).rejects.toThrow('OIDC subject is missing.');
    });
  });

  describe('refresh', () => {
    it('refresh 토큰을 성공적으로 회전시켜야 한다', async () => {
      // Arrange
      const mockReq = {
        cookies: {
          caquick_rt: 'old-refresh-token',
        },
        headers: {
          'user-agent': 'Mozilla/5.0',
        },
        ip: '127.0.0.1',
      } as unknown as Request;

      const mockRes = {
        cookie: jest.fn(),
      } as unknown as Response;

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_EXPIRES_SECONDS') return '900';
        if (key === 'AUTH_REFRESH_EXPIRES_DAYS') return '30';
        if (key === 'AUTH_COOKIE_DOMAIN') return undefined;
        if (key === 'AUTH_COOKIE_SECURE') return 'false';
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      mockRefreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(1),
      } as never);

      mockRefreshSessions.rotateRefreshSession.mockResolvedValue({} as never);
      mockJwt.sign.mockReturnValue('new-access-token');

      // Act
      const result = await service.refresh(mockReq, mockRes);

      // Assert
      expect(
        mockRefreshSessions.findActiveRefreshSessionByHash,
      ).toHaveBeenCalled();
      expect(mockRefreshSessions.rotateRefreshSession).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'new-access-token' });
      expect(mockRes.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE.REFRESH,
        expect.any(String),
        expect.any(Object),
      );
    });

    it('refresh 토큰이 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const mockRes = {} as Response;

      // Act & Assert
      await expect(service.refresh(mockReq, mockRes)).rejects.toThrow(
        'Missing refresh token.',
      );
    });

    it('유효하지 않은 refresh 토큰이면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const mockReq = {
        cookies: {
          caquick_rt: 'invalid-token',
        },
      } as unknown as Request;

      const mockRes = {} as Response;

      mockRefreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(service.refresh(mockReq, mockRes)).rejects.toThrow(
        'Invalid refresh token.',
      );
    });
  });

  describe('logout', () => {
    it('refresh 세션을 revoke하고 쿠키를 삭제해야 한다', async () => {
      // Arrange
      const mockReq = {
        cookies: {
          caquick_rt: 'valid-token',
        },
      } as unknown as Request;

      const mockRes = {
        clearCookie: jest.fn(),
      } as unknown as Response;

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'AUTH_COOKIE_DOMAIN') return undefined;
        if (key === 'AUTH_COOKIE_SECURE') return 'false';
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      mockRefreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
      } as never);

      mockRefreshSessions.revokeRefreshSession.mockResolvedValue({} as never);

      // Act
      await service.logout(mockReq, mockRes);

      // Assert
      expect(mockRefreshSessions.revokeRefreshSession).toHaveBeenCalledWith(
        BigInt(1),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(1); // refresh
    });

    it('refresh 토큰이 없어도 쿠키를 삭제해야 한다', async () => {
      // Arrange
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const mockRes = {
        clearCookie: jest.fn(),
      } as unknown as Response;

      mockConfig.get.mockReturnValue(undefined);

      // Act
      await service.logout(mockReq, mockRes);

      // Assert
      expect(mockRefreshSessions.revokeRefreshSession).not.toHaveBeenCalled();
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(1);
    });
  });

  describe('me', () => {
    it('사용자 정보를 성공적으로 반환해야 한다', async () => {
      // Arrange
      mockAccounts.findAccountForMe.mockResolvedValue({
        id: BigInt(1),
        email: 'test@example.com',
        name: 'Test User',
        user_profile: {
          nickname: 'testuser',
          profile_image_url: 'https://example.com/photo.jpg',
          birth_date: new Date('1990-01-01'),
          phone_number: '010-1234-5678',
        },
      } as never);

      // Act
      const result = await service.me(BigInt(1));

      // Assert
      expect(result).toEqual({
        accountId: '1',
        email: 'test@example.com',
        name: 'Test User',
        nickname: 'testuser',
        profileImageUrl: 'https://example.com/photo.jpg',
        birthDate: '1990-01-01',
        phoneNumber: '010-1234-5678',
        needsProfile: false,
      });
    });

    it('프로필 정보가 불완전하면 needsProfile이 true여야 한다', async () => {
      // Arrange
      mockAccounts.findAccountForMe.mockResolvedValue({
        id: BigInt(1),
        email: 'test@example.com',
        name: 'Test User',
        user_profile: {
          nickname: 'testuser',
          profile_image_url: null,
          birth_date: null, // 누락
          phone_number: null, // 누락
        },
      } as never);

      // Act
      const result = await service.me(BigInt(1));

      // Assert
      expect(result.needsProfile).toBe(true);
    });

    it('계정을 찾을 수 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      mockAccounts.findAccountForMe.mockResolvedValue(null);

      // Act & Assert
      await expect(service.me(BigInt(999))).rejects.toThrow(
        'Account not found.',
      );
    });

    it('user_profile이 아예 null이면 모든 프로필 필드가 null + needsProfile=true', async () => {
      mockAccounts.findAccountForMe.mockResolvedValue({
        id: BigInt(1),
        email: null,
        name: null,
        user_profile: null,
      } as never);

      const result = await service.me(BigInt(1));

      expect(result.nickname).toBeNull();
      expect(result.profileImageUrl).toBeNull();
      expect(result.birthDate).toBeNull();
      expect(result.phoneNumber).toBeNull();
      expect(result.needsProfile).toBe(true);
    });
  });

  describe('startOidcLogin returnTo 분기 (빈 값/공백)', () => {
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

  describe('issueDevAccessToken', () => {
    beforeEach(() => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_EXPIRES_SECONDS') return '900';
        return undefined;
      });
      mockJwt.sign.mockReturnValue('signed-access-token');
    });

    it('정상 발급: 활성 USER 계정이면 access token + 만료 정보를 반환한다', async () => {
      mockAccounts.findAccountForJwt.mockResolvedValue({
        id: BigInt(1),
        status: 'ACTIVE',
        account_type: 'USER',
      });

      const result = await service.issueDevAccessToken(BigInt(1));

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        tokenType: 'Bearer',
        expiresInSeconds: 900,
      });
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: '1', typ: 'access' }),
      );
    });

    it('존재하지 않는 accountId면 NotFoundException', async () => {
      mockAccounts.findAccountForJwt.mockResolvedValue(null);

      await expect(service.issueDevAccessToken(BigInt(999))).rejects.toThrow(
        NotFoundException,
      );
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });

    it('비활성(SUSPENDED) 계정이면 ForbiddenException', async () => {
      mockAccounts.findAccountForJwt.mockResolvedValue({
        id: BigInt(2),
        status: 'SUSPENDED',
        account_type: 'USER',
      });

      await expect(service.issueDevAccessToken(BigInt(2))).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });
  });
});
