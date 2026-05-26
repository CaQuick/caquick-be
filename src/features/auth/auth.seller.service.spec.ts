import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuthService } from '@/features/auth/auth.service';
import { AuthRepository } from '@/features/auth/repositories/auth.repository';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';

describe('AuthService (seller)', () => {
  let service: AuthService;
  let repo: jest.Mocked<AuthRepository>;
  let refreshSessions: jest.Mocked<IRefreshSessionRepository>;
  let auditLogs: jest.Mocked<IAuditLogRepository>;
  let mockConfig: jest.Mocked<ConfigService>;

  const mockReq = {
    headers: { 'user-agent': 'Mozilla/5.0 TestBrowser' },
    ip: '127.0.0.1',
    cookies: {},
  } as unknown as Request;

  const mockRes = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    repo = {
      findSellerCredentialByUsername: jest.fn(),
      findSellerCredentialByAccountId: jest.fn(),
      updateSellerLastLogin: jest.fn(),
      updateSellerPasswordHash: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;

    refreshSessions = {
      createRefreshSession: jest.fn(),
      findActiveRefreshSessionByHash: jest.fn(),
      rotateRefreshSession: jest.fn(),
      revokeRefreshSession: jest.fn(),
      revokeAllRefreshSessions: jest.fn(),
    };

    auditLogs = {
      createAuditLog: jest.fn(),
    };

    mockConfig = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(() => 'mock-access-token') },
        },
        { provide: OidcClientService, useValue: {} },
        { provide: AuthRepository, useValue: repo },
        {
          provide: REFRESH_SESSION_REPOSITORY,
          useValue: refreshSessions,
        },
        {
          provide: AUDIT_LOG_REPOSITORY,
          useValue: auditLogs,
        },
        { provide: ClockService, useValue: { now: () => new Date() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sellerLogin', () => {
    const validCredential = {
      id: BigInt(1),
      seller_account_id: BigInt(10),
      username: 'seller01',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc$hashedPw',
      password_updated_at: new Date('2025-03-01'),
      last_login_at: new Date('2025-06-10'),
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-06-10'),
      deleted_at: null,
      seller_account: {
        id: BigInt(10),
        account_type: AccountType.SELLER,
        status: 'PENDING' as const,
        store: { id: BigInt(5) },
      },
    };

    it('판매자 로그인 성공 시 accessToken과 accountStatus를 반환해야 한다', async () => {
      // Arrange
      jest.spyOn(argon2, 'verify').mockResolvedValue(true);
      repo.findSellerCredentialByUsername.mockResolvedValue(validCredential);

      // Act
      const result = await service.sellerLogin({
        username: 'seller01',
        password: 'Password!123',
        req: mockReq,
        res: mockRes,
      });

      // Assert
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.accountStatus).toBe('PENDING');
      expect(repo.updateSellerLastLogin).toHaveBeenCalledWith(
        BigInt(10),
        expect.any(Date),
      );
    });

    it('username이 빈 문자열이면 UnauthorizedException을 던져야 한다', async () => {
      // Act & Assert
      await expect(
        service.sellerLogin({
          username: '   ',
          password: 'Password!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('password가 빈 문자열이면 UnauthorizedException을 던져야 한다', async () => {
      // Act & Assert
      await expect(
        service.sellerLogin({
          username: 'seller01',
          password: '',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('공백만 있는 비밀번호이면 UnauthorizedException을 던져야 한다', async () => {
      // Act & Assert
      await expect(
        service.sellerLogin({
          username: 'seller01',
          password: '   ',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('존재하지 않는 판매자이면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      repo.findSellerCredentialByUsername.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.sellerLogin({
          username: 'nonexistent',
          password: 'Password!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.sellerLogin({
          username: 'nonexistent',
          password: 'Password!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow('Invalid seller credentials.');
    });

    it('account_type이 SELLER가 아니면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const nonSellerCredential = {
        ...validCredential,
        seller_account: {
          ...validCredential.seller_account,
          account_type: AccountType.USER,
        },
      };
      repo.findSellerCredentialByUsername.mockResolvedValue(
        nonSellerCredential,
      );

      // Act & Assert
      await expect(
        service.sellerLogin({
          username: 'seller01',
          password: 'Password!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.sellerLogin({
          username: 'seller01',
          password: 'Password!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow('Invalid seller credentials.');
    });

    it('비밀번호가 틀리면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      jest.spyOn(argon2, 'verify').mockResolvedValue(false);
      repo.findSellerCredentialByUsername.mockResolvedValue(validCredential);

      // Act & Assert
      await expect(
        service.sellerLogin({
          username: 'seller01',
          password: 'WrongPassword!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.sellerLogin({
          username: 'seller01',
          password: 'WrongPassword!123',
          req: mockReq,
          res: mockRes,
        }),
      ).rejects.toThrow('Invalid seller credentials.');
    });
  });

  describe('changeSellerPassword', () => {
    const sellerCredential = {
      id: BigInt(1),
      seller_account_id: BigInt(10),
      username: 'seller01',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc$currentHash',
      password_updated_at: new Date('2025-03-01'),
      last_login_at: new Date('2025-06-10'),
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-06-10'),
      deleted_at: null,
      seller_account: {
        id: BigInt(10),
        account_type: AccountType.SELLER,
        status: 'ACTIVE' as const,
        store: { id: BigInt(5) },
      },
    };

    it('비밀번호를 성공적으로 변경해야 한다', async () => {
      // Arrange
      repo.findSellerCredentialByAccountId.mockResolvedValue(sellerCredential);
      // 첫 번째 호출: 현재 비밀번호 확인 (true)
      // 두 번째 호출: 새 비밀번호 동일 여부 확인 (false = 다른 비밀번호)
      jest
        .spyOn(argon2, 'verify')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      jest
        .spyOn(argon2, 'hash')
        .mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$new$newHash');

      // Act
      await service.changeSellerPassword({
        accountId: BigInt(10),
        currentPassword: 'OldPassword!123',
        newPassword: 'NewPassword!456',
        req: mockReq,
      });

      // Assert
      expect(repo.updateSellerPasswordHash).toHaveBeenCalledWith({
        sellerAccountId: BigInt(10),
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$new$newHash',
        now: expect.any(Date),
      });
      expect(refreshSessions.revokeAllRefreshSessions).toHaveBeenCalledWith(
        BigInt(10),
        expect.any(Date),
      );
      expect(auditLogs.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAccountId: BigInt(10),
          storeId: BigInt(5),
          targetId: BigInt(10),
        }),
      );
    });

    it('판매자를 찾을 수 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      repo.findSellerCredentialByAccountId.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(999),
          currentPassword: 'OldPassword!123',
          newPassword: 'NewPassword!456',
          req: mockReq,
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(999),
          currentPassword: 'OldPassword!123',
          newPassword: 'NewPassword!456',
          req: mockReq,
        }),
      ).rejects.toThrow('Seller not found.');
    });

    it('account_type이 SELLER가 아니면 ForbiddenException을 던져야 한다', async () => {
      // Arrange
      const nonSellerCredential = {
        ...sellerCredential,
        seller_account: {
          ...sellerCredential.seller_account,
          account_type: AccountType.USER,
        },
      };
      repo.findSellerCredentialByAccountId.mockResolvedValue(
        nonSellerCredential,
      );

      // Act & Assert
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(10),
          currentPassword: 'OldPassword!123',
          newPassword: 'NewPassword!456',
          req: mockReq,
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(10),
          currentPassword: 'OldPassword!123',
          newPassword: 'NewPassword!456',
          req: mockReq,
        }),
      ).rejects.toThrow('Only SELLER account is allowed.');
    });

    // NOTE: currentPassword/newPassword 의 형식 검증(빈 문자열, 길이, 복잡도)은
    // DTO + ValidationPipe 책임으로 이전됨 (P0-3).
    // - 길이/필수 검증: seller-change-password.input.spec.ts
    // - 강 정책 검증: strong-password.validator.spec.ts

    it('현재 비밀번호가 틀리면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      repo.findSellerCredentialByAccountId.mockResolvedValue(sellerCredential);
      jest.spyOn(argon2, 'verify').mockResolvedValue(false);

      // Act & Assert
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(10),
          currentPassword: 'WrongPassword!123',
          newPassword: 'NewPassword!456',
          req: mockReq,
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(10),
          currentPassword: 'WrongPassword!123',
          newPassword: 'NewPassword!456',
          req: mockReq,
        }),
      ).rejects.toThrow('Current password is invalid.');
    });

    it('새 비밀번호가 기존 비밀번호와 동일하면 BadRequestException을 던져야 한다', async () => {
      // Arrange
      repo.findSellerCredentialByAccountId.mockResolvedValue(sellerCredential);
      // 현재 비밀번호 확인: true, 새 비밀번호 동일 여부: true (같은 비밀번호)
      jest
        .spyOn(argon2, 'verify')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      // Act & Assert
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(10),
          currentPassword: 'SamePassword!123',
          newPassword: 'SamePassword!123',
          req: mockReq,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changeSellerPassword({
          accountId: BigInt(10),
          currentPassword: 'SamePassword!123',
          newPassword: 'SamePassword!123',
          req: mockReq,
        }),
      ).rejects.toThrow(
        'New password must be different from current password.',
      );
    });
  });

  describe('refreshSeller', () => {
    it('판매자 refresh 재발급 시 accessToken과 accountStatus를 반환해야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'valid-refresh-token' },
        headers: { 'user-agent': 'Mozilla/5.0 TestBrowser' },
        ip: '127.0.0.1',
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0 TestBrowser',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
      });

      refreshSessions.rotateRefreshSession.mockResolvedValue({
        id: BigInt(2),
        account_id: BigInt(10),
        token_hash: 'new-hash',
      } as never);

      repo.findSellerCredentialByAccountId.mockResolvedValue({
        id: BigInt(1),
        seller_account_id: BigInt(10),
        username: 'seller01',
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc$hash',
        password_updated_at: new Date('2025-03-01'),
        last_login_at: new Date('2025-06-10'),
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-10'),
        deleted_at: null,
        seller_account: {
          id: BigInt(10),
          account_type: AccountType.SELLER,
          status: 'ACTIVE' as const,
          store: { id: BigInt(5) },
        },
      });

      // Act
      const result = await service.refreshSeller(reqWithCookie, mockRes);

      // Assert
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.accountStatus).toBe('ACTIVE');
    });

    it('refresh 토큰이 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqNoCookie = {
        cookies: {},
      } as unknown as Request;

      // Act & Assert
      await expect(service.refreshSeller(reqNoCookie, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshSeller(reqNoCookie, mockRes)).rejects.toThrow(
        'Missing refresh token.',
      );
    });

    it('유효하지 않은 refresh 토큰이면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'invalid-refresh-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.refreshSeller(reqWithCookie, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.refreshSeller(reqWithCookie, mockRes),
      ).rejects.toThrow('Invalid refresh token.');
    });

    it('판매자 자격정보가 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'valid-refresh-token' },
        headers: { 'user-agent': 'Mozilla/5.0' },
        ip: '127.0.0.1',
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
      });

      refreshSessions.rotateRefreshSession.mockResolvedValue({
        id: BigInt(2),
        account_id: BigInt(10),
        token_hash: 'new-hash',
      } as never);

      repo.findSellerCredentialByAccountId.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.refreshSeller(reqWithCookie, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.refreshSeller(reqWithCookie, mockRes),
      ).rejects.toThrow('Invalid seller refresh token.');
    });

    it('account_type이 SELLER가 아니면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'valid-refresh-token' },
        headers: { 'user-agent': 'Mozilla/5.0' },
        ip: '127.0.0.1',
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
      });

      refreshSessions.rotateRefreshSession.mockResolvedValue({
        id: BigInt(2),
        account_id: BigInt(10),
        token_hash: 'new-hash',
      } as never);

      repo.findSellerCredentialByAccountId.mockResolvedValue({
        id: BigInt(1),
        seller_account_id: BigInt(10),
        username: 'seller01',
        password_hash: '$argon2id$v=19$hash',
        seller_account: {
          id: BigInt(10),
          account_type: AccountType.USER, // SELLER가 아님
          status: 'ACTIVE' as const,
          store: null,
        },
      } as never);

      // Act & Assert
      await expect(
        service.refreshSeller(reqWithCookie, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.refreshSeller(reqWithCookie, mockRes),
      ).rejects.toThrow('Invalid seller refresh token.');
    });
  });

  describe('logoutSeller', () => {
    it('판매자 로그아웃 시 세션을 revoke하고 쿠키를 삭제해야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'valid-refresh-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
      });

      repo.findSellerCredentialByAccountId.mockResolvedValue({
        id: BigInt(1),
        seller_account_id: BigInt(10),
        username: 'seller01',
        password_hash: '$argon2id$v=19$hash',
        password_updated_at: new Date('2025-03-01'),
        last_login_at: new Date('2025-06-10'),
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-10'),
        deleted_at: null,
        seller_account: {
          id: BigInt(10),
          account_type: AccountType.SELLER,
          status: 'ACTIVE' as const,
          store: { id: BigInt(5) },
        },
      });

      refreshSessions.revokeRefreshSession.mockResolvedValue({
        id: BigInt(1),
        revoked_at: new Date(),
      } as never);

      // Act
      await service.logoutSeller(reqWithCookie, mockRes);

      // Assert
      expect(refreshSessions.revokeRefreshSession).toHaveBeenCalledWith(
        BigInt(1),
      );
      expect(mockRes.clearCookie).toHaveBeenCalled();
    });

    it('refresh 토큰이 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqNoCookie = {
        cookies: {},
      } as unknown as Request;

      // Act & Assert
      await expect(service.logoutSeller(reqNoCookie, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.logoutSeller(reqNoCookie, mockRes)).rejects.toThrow(
        'Missing refresh token.',
      );
    });

    it('유효하지 않은 refresh 토큰이면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'invalid-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.logoutSeller(reqWithCookie, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.logoutSeller(reqWithCookie, mockRes),
      ).rejects.toThrow('Invalid refresh token.');
    });

    it('판매자 자격정보가 없으면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'valid-refresh-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
      });

      repo.findSellerCredentialByAccountId.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.logoutSeller(reqWithCookie, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.logoutSeller(reqWithCookie, mockRes),
      ).rejects.toThrow('Invalid seller refresh token.');
    });

    it('account_type이 SELLER가 아니면 UnauthorizedException을 던져야 한다', async () => {
      // Arrange
      const reqWithCookie = {
        cookies: { caquick_rt: 'valid-refresh-token' },
      } as unknown as Request;

      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
      });

      repo.findSellerCredentialByAccountId.mockResolvedValue({
        id: BigInt(1),
        seller_account_id: BigInt(10),
        username: 'seller01',
        password_hash: '$argon2id$v=19$hash',
        seller_account: {
          id: BigInt(10),
          account_type: AccountType.USER, // SELLER가 아님
          status: 'ACTIVE' as const,
          store: null,
        },
      } as never);

      // Act & Assert
      await expect(
        service.logoutSeller(reqWithCookie, mockRes),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.logoutSeller(reqWithCookie, mockRes),
      ).rejects.toThrow('Invalid seller refresh token.');
    });
  });
});
