import { Test, TestingModule } from '@nestjs/testing';
import { AccountType, IdentityProvider } from '@prisma/client';

import { PrismaService } from '../../../prisma';

import { AuthRepository } from './auth.repository';

describe('AuthRepository', () => {
  let repository: AuthRepository;
  let mockPrisma: {
    accountIdentity: {
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    account: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    userProfile: {
      create: jest.Mock;
    };
    authRefreshSession: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = {
      accountIdentity: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      account: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      userProfile: {
        create: jest.fn(),
      },
      authRefreshSession: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<AuthRepository>(AuthRepository);
  });

  describe('upsertUserByOidcIdentity', () => {
    it('기존 Identity가 있으면 업데이트해야 한다', async () => {
      // Arrange
      const existingIdentity = {
        id: BigInt(1),
        account_id: BigInt(10),
        provider: IdentityProvider.GOOGLE,
        provider_subject: 'google-123',
        account: {
          id: BigInt(10),
          email: 'old@example.com',
          name: 'Old Name',
          user_profile: {
            nickname: 'olduser',
          },
        },
      };

      mockPrisma.accountIdentity.findFirst.mockResolvedValue(existingIdentity);
      mockPrisma.accountIdentity.update.mockResolvedValue({});
      mockPrisma.account.update.mockResolvedValue({});
      mockPrisma.account.findUnique.mockResolvedValue({
        id: BigInt(10),
        email: 'new@example.com',
        user_profile: { nickname: 'olduser' },
      });

      const args = {
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-123',
        providerEmail: 'new@example.com',
        emailVerified: true,
        providerDisplayName: 'New Name',
        providerProfileImageUrl: 'https://example.com/photo.jpg',
      };

      // Act
      const result = await repository.upsertUserByOidcIdentity(args);

      // Assert
      expect(mockPrisma.accountIdentity.update).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        data: expect.objectContaining({
          provider_email: 'new@example.com',
          provider_display_name: 'New Name',
          provider_profile_image_url: 'https://example.com/photo.jpg',
        }),
      });
      expect(result.account).toBeDefined();
    });

    it('기존 Identity가 있고 profile이 없으면 profile을 생성해야 한다', async () => {
      // Arrange
      const existingIdentity = {
        id: BigInt(1),
        account_id: BigInt(10),
        account: {
          id: BigInt(10),
          email: 'test@example.com',
          name: 'Test User',
          user_profile: null, // profile 없음
        },
      };

      mockPrisma.accountIdentity.findFirst.mockResolvedValue(existingIdentity);
      mockPrisma.accountIdentity.update.mockResolvedValue({});
      mockPrisma.account.update.mockResolvedValue({});
      mockPrisma.userProfile.create.mockResolvedValue({});
      mockPrisma.account.findUnique.mockResolvedValue({
        id: BigInt(10),
        user_profile: { nickname: 'test' },
      });

      const args = {
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-123',
        providerEmail: 'test@example.com',
        emailVerified: true,
        providerDisplayName: 'Test User',
      };

      // Act
      await repository.upsertUserByOidcIdentity(args);

      // Assert
      expect(mockPrisma.userProfile.create).toHaveBeenCalledWith({
        data: {
          account_id: BigInt(10),
          nickname: 'Test User',
          profile_image_url: null,
        },
      });
    });

    it('신규 Identity이고 이메일로 기존 계정을 찾으면 연결해야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null); // 신규

      const existingAccount = {
        id: BigInt(20),
        email: 'existing@example.com',
      };
      mockPrisma.account.findFirst.mockResolvedValue(existingAccount);

      mockPrisma.accountIdentity.create.mockResolvedValue({});
      mockPrisma.account.findUnique.mockResolvedValue({
        id: BigInt(20),
        user_profile: { nickname: 'existing' },
      });

      const args = {
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-new-user',
        providerEmail: 'existing@example.com',
        emailVerified: true, // verified여야 연결
        providerDisplayName: 'Existing User',
      };

      // Act
      await repository.upsertUserByOidcIdentity(args);

      // Assert
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { email: 'existing@example.com', deleted_at: null },
      });
      expect(mockPrisma.accountIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          account_id: BigInt(20),
          provider: IdentityProvider.GOOGLE,
          provider_subject: 'google-new-user',
        }),
      });
      expect(mockPrisma.account.create).not.toHaveBeenCalled(); // 신규 계정 생성 안 함
    });

    it('신규 Identity이고 기존 계정이 없으면 새 계정을 생성해야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null); // 신규
      mockPrisma.account.findFirst.mockResolvedValue(null); // 기존 계정 없음

      const newAccount = {
        id: BigInt(30),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'new@example.com',
        name: 'New User',
      };
      mockPrisma.account.create.mockResolvedValue(newAccount);
      mockPrisma.userProfile.create.mockResolvedValue({});
      mockPrisma.accountIdentity.create.mockResolvedValue({});
      mockPrisma.account.findUnique.mockResolvedValue({
        id: BigInt(30),
        user_profile: { nickname: 'new' },
      });

      const args = {
        provider: IdentityProvider.KAKAO,
        providerSubject: 'kakao-new-user',
        providerEmail: 'new@example.com',
        emailVerified: true,
        providerDisplayName: 'New User',
      };

      // Act
      const result = await repository.upsertUserByOidcIdentity(args);

      // Assert
      expect(mockPrisma.account.create).toHaveBeenCalledWith({
        data: {
          account_type: AccountType.USER,
          status: 'ACTIVE',
          email: 'new@example.com',
          name: 'New User',
        },
      });
      expect(mockPrisma.userProfile.create).toHaveBeenCalledWith({
        data: {
          account_id: BigInt(30),
          nickname: 'New User',
          profile_image_url: null,
        },
      });
      expect(mockPrisma.accountIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          account_id: BigInt(30),
          provider: IdentityProvider.KAKAO,
          provider_subject: 'kakao-new-user',
        }),
      });
      expect(result.account?.id).toBe(BigInt(30));
    });

    it('이메일이 verified가 아니면 기존 계정에 연결하지 않아야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(40),
        email: 'test@example.com',
      });

      const newAccount = { id: BigInt(50) };
      mockPrisma.account.create.mockResolvedValue(newAccount as never);
      mockPrisma.userProfile.create.mockResolvedValue({});
      mockPrisma.accountIdentity.create.mockResolvedValue({});
      mockPrisma.account.findUnique.mockResolvedValue({
        id: BigInt(50),
        user_profile: {},
      });

      const args = {
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-unverified',
        providerEmail: 'test@example.com',
        emailVerified: false, // verified 아님
      };

      // Act
      await repository.upsertUserByOidcIdentity(args);

      // Assert
      // 이메일로 기존 계정을 찾지 않아야 함
      expect(mockPrisma.account.findFirst).not.toHaveBeenCalled();
      // 신규 계정 생성
      expect(mockPrisma.account.create).toHaveBeenCalled();
    });

    it('displayName이 없고 email이 있으면 email의 local part를 nickname으로 사용해야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(null);

      const newAccount = { id: BigInt(60) };
      mockPrisma.account.create.mockResolvedValue(newAccount as never);
      mockPrisma.userProfile.create.mockResolvedValue({});
      mockPrisma.accountIdentity.create.mockResolvedValue({});
      mockPrisma.account.findUnique.mockResolvedValue({
        id: BigInt(60),
        user_profile: {},
      });

      const args = {
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-no-name',
        providerEmail: 'testuser@example.com',
        emailVerified: true,
        // providerDisplayName 없음
      };

      // Act
      await repository.upsertUserByOidcIdentity(args);

      // Assert
      expect(mockPrisma.userProfile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nickname: 'testuser', // email의 local part
        }),
      });
    });
  });

  describe('createRefreshSession', () => {
    it('refresh 세션을 생성해야 한다', async () => {
      // Arrange
      const args = {
        accountId: BigInt(1),
        tokenHash: 'hashed-token',
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
        expiresAt: new Date('2025-02-01'),
      };

      mockPrisma.authRefreshSession.create.mockResolvedValue({
        id: BigInt(100),
        ...args,
      });

      // Act
      const result = await repository.createRefreshSession(args);

      // Assert
      expect(mockPrisma.authRefreshSession.create).toHaveBeenCalledWith({
        data: {
          account_id: BigInt(1),
          token_hash: 'hashed-token',
          user_agent: 'Mozilla/5.0',
          ip_address: '127.0.0.1',
          expires_at: args.expiresAt,
        },
      });
      expect(result.id).toBe(BigInt(100));
    });
  });

  describe('findActiveRefreshSessionByHash', () => {
    it('유효한 refresh 세션을 찾아야 한다', async () => {
      // Arrange
      const session = {
        id: BigInt(1),
        token_hash: 'valid-hash',
        account_id: BigInt(1),
        deleted_at: null,
        revoked_at: null,
        expires_at: new Date('2030-01-01'),
      };

      mockPrisma.authRefreshSession.findFirst.mockResolvedValue(session);

      // Act
      const result =
        await repository.findActiveRefreshSessionByHash('valid-hash');

      // Assert
      expect(result).toEqual(session);
      expect(mockPrisma.authRefreshSession.findFirst).toHaveBeenCalledWith({
        where: {
          token_hash: 'valid-hash',
          deleted_at: null,
          revoked_at: null,
          expires_at: { gt: expect.any(Date) },
        },
      });
    });

    it('만료되거나 revoked된 세션은 찾지 않아야 한다', async () => {
      // Arrange
      mockPrisma.authRefreshSession.findFirst.mockResolvedValue(null);

      // Act
      const result =
        await repository.findActiveRefreshSessionByHash('expired-hash');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('rotateRefreshSession', () => {
    it('기존 세션을 revoke하고 새 세션을 생성해야 한다', async () => {
      // Arrange
      const args = {
        currentSessionId: BigInt(1),
        accountId: BigInt(10),
        newTokenHash: 'new-hash',
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
        newExpiresAt: new Date('2025-03-01'),
      };

      const newSession = {
        id: BigInt(2),
        account_id: BigInt(10),
        token_hash: 'new-hash',
      };

      mockPrisma.authRefreshSession.create.mockResolvedValue(newSession);
      mockPrisma.authRefreshSession.update.mockResolvedValue({});

      // Act
      const result = await repository.rotateRefreshSession(args);

      // Assert
      expect(mockPrisma.authRefreshSession.create).toHaveBeenCalled();
      expect(mockPrisma.authRefreshSession.update).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        data: expect.objectContaining({
          revoked_at: expect.any(Date),
          replaced_by_session_id: BigInt(2),
        }),
      });
      expect(result).toEqual(newSession);
    });
  });

  describe('revokeRefreshSession', () => {
    it('세션을 revoke해야 한다', async () => {
      // Arrange
      mockPrisma.authRefreshSession.update.mockResolvedValue({
        id: BigInt(1),
        revoked_at: new Date(),
      });

      // Act
      const result = await repository.revokeRefreshSession(BigInt(1));

      // Assert
      expect(mockPrisma.authRefreshSession.update).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        data: {
          revoked_at: expect.any(Date),
          updated_at: expect.any(Date),
        },
      });
      expect(result.id).toBe(BigInt(1));
    });
  });

  describe('findAccountForMe', () => {
    it('account를 profile과 함께 조회해야 한다', async () => {
      // Arrange
      const account = {
        id: BigInt(1),
        email: 'test@example.com',
        user_profile: {
          nickname: 'testuser',
        },
      };

      mockPrisma.account.findFirst.mockResolvedValue(account);

      // Act
      const result = await repository.findAccountForMe(BigInt(1));

      // Assert
      expect(result).toEqual(account);
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), deleted_at: null },
        include: { user_profile: true },
      });
    });

    it('삭제된 계정은 찾지 않아야 한다', async () => {
      // Arrange
      mockPrisma.account.findFirst.mockResolvedValue(null);

      // Act
      const result = await repository.findAccountForMe(BigInt(999));

      // Assert
      expect(result).toBeNull();
    });
  });
});
