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
import { TokenService } from '@/features/auth/services/token.service';
import { TOKEN_SERVICE } from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

describe('AuthService', () => {
  let service: AuthService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockJwt: jest.Mocked<JwtService>;
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

    mockAccounts = {
      findIdentityByProviderSubject: jest.fn(),
      findAccountByEmail: jest.fn(),
      upsertUserByOidcIdentity: jest.fn(),
      findAccountForJwt: jest.fn(),
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

  // OIDC 흐름 (startOidcLogin / handleOidcCallback) 은 OidcLoginService 로 분리.
  // 해당 케이스는 oidc-login.service.spec.ts 에서 다룬다.

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
