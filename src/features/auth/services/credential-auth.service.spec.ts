import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  ACCOUNT_CREDENTIAL_REPOSITORY,
  type AccountCredentialWithAccount,
  type IAccountCredentialRepository,
} from '@/features/auth/repositories/account-credential.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import {
  CredentialAuthService,
  type CredentialRole,
} from '@/features/auth/services/credential-auth.service';
import { TokenService } from '@/features/auth/services/token.service';
import { AccountType } from '@/generated/prisma/client';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';

function makeCredential(
  overrides: Partial<AccountCredentialWithAccount> & {
    accountType?: AccountType;
  } = {},
): AccountCredentialWithAccount {
  const { accountType = AccountType.SELLER, ...rest } = overrides;
  return {
    id: BigInt(1),
    account_id: BigInt(10),
    username: 'seller01',
    password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc$hashedPw',
    password_updated_at: new Date('2025-03-01'),
    last_login_at: new Date('2025-06-10'),
    must_change_password: false,
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-06-10'),
    deleted_at: null,
    account: {
      id: BigInt(10),
      account_type: accountType,
      status: 'ACTIVE',
      store: accountType === AccountType.SELLER ? { id: BigInt(5) } : null,
    },
    ...rest,
  };
}

describe('CredentialAuthService', () => {
  let service: CredentialAuthService;
  let credentials: jest.Mocked<IAccountCredentialRepository>;
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
    credentials = {
      findCredentialByUsername: jest.fn(),
      findCredentialByAccountId: jest.fn(),
      updateLastLogin: jest.fn(),
      updatePasswordHash: jest.fn(),
    };

    refreshSessions = {
      createRefreshSession: jest.fn(),
      findActiveRefreshSessionByHash: jest.fn(),
      rotateRefreshSession: jest.fn(),
      revokeRefreshSession: jest.fn(),
      revokeAllRefreshSessions: jest.fn(),
    };

    auditLogs = {
      createAuditLog: jest.fn(),
      countAuditLogsBySeller: jest.fn(),
      listAuditLogsBySeller: jest.fn(),
      countAuditLogs: jest.fn(),
      listAuditLogs: jest.fn(),
    };

    mockConfig = {
      get: jest.fn(),
      // 소비처는 raw env가 아니라 authConfig 네임스페이스를 읽는다(P1-11a)
      getOrThrow: jest.fn(() => TEST_AUTH_CONFIG),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialAuthService,
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(() => 'mock-access-token') },
        },
        TokenService,
        {
          provide: ACCOUNT_CREDENTIAL_REPOSITORY,
          useValue: credentials,
        },
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

    service = module.get<CredentialAuthService>(CredentialAuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('login', () => {
    const login = (
      overrides: Partial<{
        role: CredentialRole;
        username: string;
        password: string;
      }> = {},
    ) =>
      service.login({
        role: 'SELLER',
        username: 'seller01',
        password: 'Password!123',
        req: mockReq,
        res: mockRes,
        ...overrides,
      });

    it.each<CredentialRole>(['SELLER', 'ADMIN'])(
      '%s 로그인 성공 시 accessToken·accountStatus·mustChangePassword를 반환한다',
      async (role) => {
        jest.spyOn(argon2, 'verify').mockResolvedValue(true);
        credentials.findCredentialByUsername.mockResolvedValue(
          makeCredential({
            accountType: role,
            must_change_password: true,
            account: {
              id: BigInt(10),
              account_type: role,
              // ACTIVE가 아니면 RefreshSessionRepository가 세션 발급을 거부한다(실DB spec)
              status: 'ACTIVE',
              store: null,
            },
          }),
        );

        const result = await login({ role });

        expect(result.accessToken).toBe('mock-access-token');
        expect(result.accountStatus).toBe('ACTIVE');
        expect(result.mustChangePassword).toBe(true);
        expect(credentials.updateLastLogin).toHaveBeenCalledWith(
          BigInt(10),
          expect.any(Date),
        );
      },
    );

    it.each([
      ['username 공백', { username: '   ' }],
      ['password 빈 문자열', { password: '' }],
      ['password 공백', { password: '   ' }],
    ])('%s이면 UnauthorizedException', async (_label, overrides) => {
      await expect(login(overrides)).rejects.toThrowDomain(401);
      expect(credentials.findCredentialByUsername).not.toHaveBeenCalled();
    });

    it('존재하지 않는 username이면 더미 해시로 verify를 태운 뒤 INVALID_CREDENTIALS', async () => {
      const verify = jest.spyOn(argon2, 'verify').mockResolvedValue(true);
      credentials.findCredentialByUsername.mockResolvedValue(null);

      await expect(login({ username: 'nonexistent' })).rejects.toThrowDomain(
        'INVALID_CREDENTIALS',
      );
      // 응답 시간 평준화 — 실제 해시가 없어도 verify는 1회 실행된다
      expect(verify).toHaveBeenCalledTimes(1);
      expect(credentials.updateLastLogin).not.toHaveBeenCalled();
    });

    // 자격증명 타입 × 요청 경로 role 전수. 대각선만 통과한다.
    it.each<[AccountType, CredentialRole]>([
      [AccountType.SELLER, 'ADMIN'],
      [AccountType.ADMIN, 'SELLER'],
      [AccountType.USER, 'SELLER'],
      [AccountType.USER, 'ADMIN'],
    ])(
      '자격증명 계정 타입(%s)이 경로 role(%s)과 다르면 실제 해시를 쓰지 않고 INVALID_CREDENTIALS',
      async (accountType, role) => {
        const verify = jest.spyOn(argon2, 'verify').mockResolvedValue(true);
        const credential = makeCredential({ accountType });
        credentials.findCredentialByUsername.mockResolvedValue(credential);

        await expect(login({ role })).rejects.toThrowDomain(
          'INVALID_CREDENTIALS',
        );
        // 더미 해시로 1회 — 비밀번호가 맞아도(verify=true) 거부되고, 실제 해시는 쓰이지 않는다
        expect(verify).toHaveBeenCalledTimes(1);
        expect(verify.mock.calls[0][0]).not.toBe(credential.password_hash);
        expect(credentials.updateLastLogin).not.toHaveBeenCalled();
      },
    );

    it('비밀번호가 틀리면 INVALID_CREDENTIALS', async () => {
      jest.spyOn(argon2, 'verify').mockResolvedValue(false);
      credentials.findCredentialByUsername.mockResolvedValue(makeCredential());

      await expect(
        login({ password: 'WrongPassword!123' }),
      ).rejects.toThrowDomain('INVALID_CREDENTIALS');
      expect(credentials.updateLastLogin).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const reqWithCookie = {
      ...mockReq,
      cookies: { [AUTH_COOKIE.REFRESH]: 'refresh-token' },
    } as unknown as Request;
    const session = { id: BigInt(77), account_id: BigInt(10) } as never;
    let rotate: jest.SpyInstance;

    beforeEach(() => {
      rotate = jest
        .spyOn(TokenService.prototype, 'rotateRefresh')
        .mockResolvedValue({ accessToken: 'rotated', accountId: BigInt(10) });
    });

    it('세션 주인의 타입이 맞으면 회전하고 자격증명 상태를 반환한다', async () => {
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(session);
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ must_change_password: true }),
      );

      const result = await service.refresh({
        role: 'SELLER',
        req: reqWithCookie,
        res: mockRes,
      });

      expect(rotate).toHaveBeenCalledWith(reqWithCookie, mockRes);
      expect(result).toEqual({
        accessToken: 'rotated',
        accountStatus: 'ACTIVE',
        mustChangePassword: true,
      });
    });

    it('refresh 쿠키가 없으면 회전 없이 MISSING_REFRESH_TOKEN', async () => {
      await expect(
        service.refresh({ role: 'SELLER', req: mockReq, res: mockRes }),
      ).rejects.toThrowDomain('MISSING_REFRESH_TOKEN');
      expect(rotate).not.toHaveBeenCalled();
    });

    it('활성 세션이 없으면 회전 없이 INVALID_REFRESH_TOKEN', async () => {
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(null);

      await expect(
        service.refresh({ role: 'SELLER', req: reqWithCookie, res: mockRes }),
      ).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
      expect(rotate).not.toHaveBeenCalled();
    });

    it('세션 주인의 타입이 경로 role과 다르면 회전하지 않는다(세션 보존)', async () => {
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(session);
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ accountType: AccountType.ADMIN }),
      );

      await expect(
        service.refresh({ role: 'SELLER', req: reqWithCookie, res: mockRes }),
      ).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
      expect(rotate).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    const reqWithCookie = {
      ...mockReq,
      cookies: { [AUTH_COOKIE.REFRESH]: 'refresh-token' },
    } as unknown as Request;
    const session = { id: BigInt(77), account_id: BigInt(10) } as never;

    it('세션을 revoke하고 쿠키를 지운다', async () => {
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(session);
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ accountType: AccountType.ADMIN }),
      );
      const clear = jest
        .spyOn(TokenService.prototype, 'clearRefreshCookie')
        .mockImplementation(() => undefined);

      await service.logout({ role: 'ADMIN', req: reqWithCookie, res: mockRes });

      expect(refreshSessions.revokeRefreshSession).toHaveBeenCalledWith(
        BigInt(77),
      );
      expect(clear).toHaveBeenCalledWith(mockRes);
    });

    it('refresh 쿠키가 없으면 MISSING_REFRESH_TOKEN', async () => {
      await expect(
        service.logout({ role: 'SELLER', req: mockReq, res: mockRes }),
      ).rejects.toThrowDomain('MISSING_REFRESH_TOKEN');
    });

    it('활성 세션이 없으면 INVALID_REFRESH_TOKEN', async () => {
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(null);

      await expect(
        service.logout({ role: 'SELLER', req: reqWithCookie, res: mockRes }),
      ).rejects.toThrowDomain('INVALID_REFRESH_TOKEN');
    });

    it('세션 계정의 타입이 경로 role과 다르면 revoke하지 않는다', async () => {
      refreshSessions.findActiveRefreshSessionByHash.mockResolvedValue(session);
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ accountType: AccountType.SELLER }),
      );

      await expect(
        service.logout({ role: 'ADMIN', req: reqWithCookie, res: mockRes }),
      ).rejects.toThrowDomain(401);
      expect(refreshSessions.revokeRefreshSession).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    const change = (
      overrides: Partial<{
        role: CredentialRole;
        accountId: bigint;
        currentPassword: string;
        newPassword: string;
      }> = {},
    ) =>
      service.changePassword({
        role: 'SELLER',
        accountId: BigInt(10),
        currentPassword: 'OldPassword!123',
        newPassword: 'NewPassword!456',
        req: mockReq,
        ...overrides,
      });

    it('비밀번호를 변경하고 전 세션 revoke + audit(매장 ID 포함)을 남긴다', async () => {
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ must_change_password: true }),
      );
      // 1) 현재 비밀번호 일치 2) 새 비밀번호는 현재와 다름
      jest
        .spyOn(argon2, 'verify')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      jest
        .spyOn(argon2, 'hash')
        .mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$new$newHash');

      await change();

      expect(credentials.updatePasswordHash).toHaveBeenCalledWith({
        accountId: BigInt(10),
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

    it('관리자는 매장이 없어 audit storeId가 null이다', async () => {
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ accountType: AccountType.ADMIN }),
      );
      jest
        .spyOn(argon2, 'verify')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      jest.spyOn(argon2, 'hash').mockResolvedValue('new-hash');

      await change({ role: 'ADMIN' });

      expect(auditLogs.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: null }),
      );
    });

    it('자격증명이 없으면 CREDENTIAL_NOT_FOUND', async () => {
      credentials.findCredentialByAccountId.mockResolvedValue(null);

      await expect(change({ accountId: BigInt(999) })).rejects.toThrowDomain(
        'CREDENTIAL_NOT_FOUND',
      );
    });

    it('계정 타입이 경로 role과 다르면 ForbiddenException(ROLE_MISMATCH)', async () => {
      credentials.findCredentialByAccountId.mockResolvedValue(
        makeCredential({ accountType: AccountType.ADMIN }),
      );

      await expect(change({ role: 'SELLER' })).rejects.toThrowDomain(
        'ROLE_MISMATCH',
      );
    });

    // currentPassword/newPassword 형식(빈 문자열·길이·복잡도)은 DTO 책임 — change-password.input.spec·strong-password.validator.spec.

    it('현재 비밀번호가 틀리면 CURRENT_PASSWORD_INVALID', async () => {
      credentials.findCredentialByAccountId.mockResolvedValue(makeCredential());
      jest.spyOn(argon2, 'verify').mockResolvedValue(false);

      await expect(
        change({ currentPassword: 'Wrong!123' }),
      ).rejects.toThrowDomain('CURRENT_PASSWORD_INVALID');
      expect(credentials.updatePasswordHash).not.toHaveBeenCalled();
    });

    it('새 비밀번호가 현재와 같으면 PASSWORD_UNCHANGED', async () => {
      credentials.findCredentialByAccountId.mockResolvedValue(makeCredential());
      jest.spyOn(argon2, 'verify').mockResolvedValue(true);

      await expect(
        change({ newPassword: 'OldPassword!123' }),
      ).rejects.toThrowDomain('PASSWORD_UNCHANGED');
      expect(credentials.updatePasswordHash).not.toHaveBeenCalled();
    });
  });
});
