import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { AUTH_COOKIE } from '../../global/auth/constants/auth-cookie.constants';

import { AuthService } from './auth.service';
import { AuthRepository } from './repositories/auth.repository';
import { OidcClientService } from './services/oidc-client.service';

describe('AuthService', () => {
  let service: AuthService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockJwt: jest.Mocked<JwtService>;
  let mockOidc: jest.Mocked<OidcClientService>;
  let mockRepo: jest.Mocked<AuthRepository>;

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

    mockRepo = {
      upsertUserByOidcIdentity: jest.fn(),
      findActiveRefreshSessionByHash: jest.fn(),
      rotateRefreshSession: jest.fn(),
      revokeRefreshSession: jest.fn(),
      findAccountForMe: jest.fn(),
      createRefreshSession: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
        { provide: OidcClientService, useValue: mockOidc },
        { provide: AuthRepository, useValue: mockRepo },
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

      mockOidc.toIdentityProvider.mockReturnValue('GOOGLE' as never);

      mockRepo.upsertUserByOidcIdentity.mockResolvedValue({
        account: {
          id: BigInt(1),
          email: 'test@example.com',
          name: 'Test User',
        } as never,
      });

      mockRepo.createRefreshSession.mockResolvedValue({} as never);
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
      expect(mockRepo.upsertUserByOidcIdentity).toHaveBeenCalledWith({
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

      mockRepo.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(1),
      } as never);

      mockRepo.rotateRefreshSession.mockResolvedValue({} as never);
      mockJwt.sign.mockReturnValue('new-access-token');

      // Act
      const result = await service.refresh(mockReq, mockRes);

      // Assert
      expect(mockRepo.findActiveRefreshSessionByHash).toHaveBeenCalled();
      expect(mockRepo.rotateRefreshSession).toHaveBeenCalled();
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

      mockRepo.findActiveRefreshSessionByHash.mockResolvedValue(null);

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

      mockRepo.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
      } as never);

      mockRepo.revokeRefreshSession.mockResolvedValue({} as never);

      // Act
      await service.logout(mockReq, mockRes);

      // Assert
      expect(mockRepo.revokeRefreshSession).toHaveBeenCalledWith(BigInt(1));
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
      expect(mockRepo.revokeRefreshSession).not.toHaveBeenCalled();
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(1);
    });
  });

  describe('me', () => {
    it('사용자 정보를 성공적으로 반환해야 한다', async () => {
      // Arrange
      mockRepo.findAccountForMe.mockResolvedValue({
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
      mockRepo.findAccountForMe.mockResolvedValue({
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
      mockRepo.findAccountForMe.mockResolvedValue(null);

      // Act & Assert
      await expect(service.me(BigInt(999))).rejects.toThrow(
        'Account not found.',
      );
    });
  });
});
