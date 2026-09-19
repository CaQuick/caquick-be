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
import { TokenService } from '@/features/auth/services/token.service';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';

describe('AuthService', () => {
  let service: AuthService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockJwt: jest.Mocked<JwtService>;
  let mockAccounts: jest.Mocked<IAccountRepository>;
  let mockRefreshSessions: jest.Mocked<IRefreshSessionRepository>;
  let mockAuditLogs: jest.Mocked<IAuditLogRepository>;

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn(),
      // 소비처는 raw env가 아니라 authConfig 네임스페이스를 읽는다(P1-11a)
      getOrThrow: jest.fn(() => TEST_AUTH_CONFIG),
    } as unknown as jest.Mocked<ConfigService>;

    mockJwt = {
      sign: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    mockAccounts = {
      findIdentityByProviderSubject: jest.fn(),
      findAccountByEmail: jest.fn(),
      upsertUserByOidcIdentity: jest.fn(),
      // 토큰 발급이 발급 시점 계정을 조회해 클레임을 만든다(P1-11b) — 기본값을 깔아 둔다
      findAccountForJwt: jest.fn().mockResolvedValue({
        id: BigInt(1),
        status: 'ACTIVE',
        account_type: 'USER',
        credential: null,
        store: null,
      }),
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
      countAuditLogsBySeller: jest.fn(),
      listAuditLogsBySeller: jest.fn(),
      countAuditLogs: jest.fn(),
      listAuditLogs: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
        TokenService,
        {
          provide: ACCOUNT_REPOSITORY,
          useValue: mockAccounts,
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

  describe('refresh', () => {
    it('refresh 토큰을 성공적으로 회전시켜야 한다', async () => {
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

      const result = await service.refresh(mockReq, mockRes);

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
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const mockRes = {} as Response;

      await expect(service.refresh(mockReq, mockRes)).rejects.toThrowDomain(
        'MISSING_REFRESH_TOKEN',
      );
    });

    it('유효하지 않은 refresh 토큰이면 UnauthorizedException을 던져야 한다', async () => {
      const mockReq = {
        cookies: {
          caquick_rt: 'invalid-token',
        },
      } as unknown as Request;

      const mockRes = {} as Response;

      mockRefreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(
        null,
      );

      await expect(service.refresh(mockReq, mockRes)).rejects.toThrowDomain(
        'INVALID_REFRESH_TOKEN',
      );
    });
  });

  describe('logout', () => {
    it('refresh 세션을 revoke하고 쿠키를 삭제해야 한다', async () => {
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

      await service.logout(mockReq, mockRes);

      expect(mockRefreshSessions.revokeRefreshSession).toHaveBeenCalledWith(
        BigInt(1),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(1); // refresh
    });

    it('refresh 토큰이 없어도 쿠키를 삭제해야 한다', async () => {
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const mockRes = {
        clearCookie: jest.fn(),
      } as unknown as Response;

      mockConfig.get.mockReturnValue(undefined);

      await service.logout(mockReq, mockRes);

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
        credential: null,
        store: null,
      });

      const result = await service.issueDevAccessToken(BigInt(1));

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        tokenType: 'Bearer',
        expiresInSeconds: 900,
      });
      // 신원 클레임만 담고 시간·발급자 클레임은 서명 옵션이 붙인다(P1-13)
      expect(mockJwt.sign).toHaveBeenCalledWith({
        sub: '1',
        typ: 'access',
        role: 'USER',
        mustChangePassword: false,
      });
    });

    it('존재하지 않는 accountId면 NotFoundException', async () => {
      mockAccounts.findAccountForJwt.mockResolvedValue(null);

      await expect(
        service.issueDevAccessToken(BigInt(999)),
      ).rejects.toThrowDomain(404);
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });

    it('비활성(SUSPENDED) 계정이면 ForbiddenException', async () => {
      mockAccounts.findAccountForJwt.mockResolvedValue({
        id: BigInt(2),
        status: 'SUSPENDED',
        account_type: 'USER',
        store: null,
        credential: null,
      });

      await expect(
        service.issueDevAccessToken(BigInt(2)),
      ).rejects.toThrowDomain(403);
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });
  });
});
