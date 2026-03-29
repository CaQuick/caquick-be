import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  IdentityProvider,
  Prisma,
} from '@prisma/client';

import { AuthRepository } from '@/features/auth/repositories/auth.repository';
import { PrismaService } from '@/prisma';

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
      updateMany: jest.Mock;
    };
    sellerCredential: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
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
        updateMany: jest.fn(),
      },
      sellerCredential: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
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

  describe('findIdentityByProviderSubject', () => {
    it('provider + subject로 AccountIdentity를 조회해야 한다', async () => {
      // Arrange
      const identity = {
        id: BigInt(1),
        account_id: BigInt(10),
        provider: IdentityProvider.GOOGLE,
        provider_subject: 'google-sub-123',
        provider_email: 'user@example.com',
        provider_display_name: 'Test User',
        provider_profile_image_url: 'https://example.com/photo.jpg',
        last_login_at: new Date('2025-06-01'),
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-01'),
        deleted_at: null,
        account: {
          id: BigInt(10),
          account_type: AccountType.USER,
          status: 'ACTIVE',
          email: 'user@example.com',
          name: 'Test User',
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-06-01'),
          deleted_at: null,
          user_profile: {
            account_id: BigInt(10),
            nickname: 'testuser',
            profile_image_url: 'https://example.com/photo.jpg',
            birth_date: null,
            phone_number: null,
          },
        },
      };

      mockPrisma.accountIdentity.findFirst.mockResolvedValue(identity);

      // Act
      const result = await repository.findIdentityByProviderSubject(
        IdentityProvider.GOOGLE,
        'google-sub-123',
      );

      // Assert
      expect(result).toEqual(identity);
      expect(mockPrisma.accountIdentity.findFirst).toHaveBeenCalledWith({
        where: {
          provider: IdentityProvider.GOOGLE,
          provider_subject: 'google-sub-123',
        },
        include: {
          account: {
            include: {
              user_profile: true,
            },
          },
        },
      });
    });

    it('존재하지 않는 identity는 null을 반환해야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null);

      // Act
      const result = await repository.findIdentityByProviderSubject(
        IdentityProvider.KAKAO,
        'non-existent-subject',
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findAccountByEmail', () => {
    it('이메일로 계정을 조회해야 한다', async () => {
      // Arrange
      const account = {
        id: BigInt(5),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'test@example.com',
        name: 'Test User',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-01'),
        deleted_at: null,
        user_profile: {
          account_id: BigInt(5),
          nickname: 'testuser',
          profile_image_url: null,
          birth_date: null,
          phone_number: null,
        },
      };

      mockPrisma.account.findFirst.mockResolvedValue(account);

      // Act
      const result = await repository.findAccountByEmail('test@example.com');

      // Assert
      expect(result).toEqual(account);
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        include: { user_profile: true },
      });
    });

    it('존재하지 않는 이메일은 null을 반환해야 한다', async () => {
      // Arrange
      mockPrisma.account.findFirst.mockResolvedValue(null);

      // Act
      const result = await repository.findAccountByEmail(
        'nonexistent@example.com',
      );

      // Assert
      expect(result).toBeNull();
    });
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
      mockPrisma.accountIdentity.update.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        provider: IdentityProvider.GOOGLE,
        provider_subject: 'google-123',
        provider_email: 'new@example.com',
        provider_display_name: 'New Name',
        provider_profile_image_url: 'https://example.com/photo.jpg',
        last_login_at: expect.any(Date),
        updated_at: expect.any(Date),
      } as never);
      mockPrisma.account.update.mockResolvedValue({
        id: BigInt(10),
        email: 'old@example.com',
        name: 'Old Name',
      } as never);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(10),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'old@example.com',
        name: 'Old Name',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-01'),
        deleted_at: null,
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
      mockPrisma.accountIdentity.update.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        provider_email: 'test@example.com',
        provider_display_name: 'Test User',
        provider_profile_image_url: null,
        last_login_at: expect.any(Date),
        updated_at: expect.any(Date),
      } as never);
      mockPrisma.account.update.mockResolvedValue({
        id: BigInt(10),
        email: 'test@example.com',
        name: 'Test User',
      } as never);
      mockPrisma.userProfile.create.mockResolvedValue({
        account_id: BigInt(10),
        nickname: 'Test User',
        profile_image_url: null,
      } as never);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(10),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'test@example.com',
        name: 'Test User',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-01'),
        deleted_at: null,
        user_profile: { nickname: 'Test User' },
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

    it('신규 Identity는 이메일과 무관하게 새 계정을 생성해야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null); // 신규

      mockPrisma.accountIdentity.create.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(30),
        provider: IdentityProvider.GOOGLE,
        provider_subject: 'google-new-user',
        provider_email: 'existing@example.com',
        provider_display_name: 'New User',
        provider_profile_image_url: null,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      } as never);
      mockPrisma.account.create.mockResolvedValue({
        id: BigInt(30),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'existing@example.com',
        name: 'New User',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      } as never);
      mockPrisma.userProfile.create.mockResolvedValue({
        account_id: BigInt(30),
        nickname: 'New User',
        profile_image_url: null,
      } as never);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(30),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'existing@example.com',
        name: 'New User',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        user_profile: { nickname: 'New User' },
      });

      const args = {
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-new-user',
        providerEmail: 'existing@example.com',
        emailVerified: true,
        providerDisplayName: 'New User',
      };

      // Act
      await repository.upsertUserByOidcIdentity(args);

      // Assert
      // 이메일로 기존 계정을 찾지 않아야 함 (id 재조회는 허용)
      expect(mockPrisma.account.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'existing@example.com' },
        }),
      );
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(30) },
        include: { user_profile: true },
      });
      expect(mockPrisma.accountIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          account_id: BigInt(30),
          provider: IdentityProvider.GOOGLE,
          provider_subject: 'google-new-user',
        }),
      });
      expect(mockPrisma.account.create).toHaveBeenCalled(); // 신규 계정 생성
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
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      };
      mockPrisma.account.create.mockResolvedValue(newAccount);
      mockPrisma.userProfile.create.mockResolvedValue({
        account_id: BigInt(30),
        nickname: 'New User',
        profile_image_url: null,
      } as never);
      mockPrisma.accountIdentity.create.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(30),
        provider: IdentityProvider.KAKAO,
        provider_subject: 'kakao-new-user',
        provider_email: 'new@example.com',
        provider_display_name: 'New User',
        provider_profile_image_url: null,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      } as never);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(30),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'new@example.com',
        name: 'New User',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        user_profile: { nickname: 'New User' },
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

    it('이메일이 verified 여부와 관계없이 기존 계정을 조회하지 않아야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null);

      const newAccount = {
        id: BigInt(50),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: null,
        name: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      };
      mockPrisma.account.create.mockResolvedValue(newAccount as never);
      mockPrisma.userProfile.create.mockResolvedValue({
        account_id: BigInt(50),
        nickname: 'testuser',
        profile_image_url: null,
      } as never);
      mockPrisma.accountIdentity.create.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(50),
        provider: IdentityProvider.GOOGLE,
        provider_subject: 'google-unverified',
        provider_email: 'test@example.com',
        provider_display_name: null,
        provider_profile_image_url: null,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      } as never);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(50),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: null,
        name: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        user_profile: { nickname: 'testuser', profile_image_url: null },
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
      expect(mockPrisma.account.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'test@example.com' },
        }),
      );
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(50) },
        include: { user_profile: true },
      });
      // 신규 계정 생성
      expect(mockPrisma.account.create).toHaveBeenCalled();
    });

    it('displayName이 없고 email이 있으면 email의 local part를 nickname으로 사용해야 한다', async () => {
      // Arrange
      mockPrisma.accountIdentity.findFirst.mockResolvedValue(null);
      mockPrisma.account.findFirst.mockResolvedValue(null);

      const newAccount = {
        id: BigInt(60),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'testuser@example.com',
        name: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      };
      mockPrisma.account.create.mockResolvedValue(newAccount as never);
      mockPrisma.userProfile.create.mockResolvedValue({
        account_id: BigInt(60),
        nickname: 'testuser',
        profile_image_url: null,
      } as never);
      mockPrisma.accountIdentity.create.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(60),
        provider: IdentityProvider.GOOGLE,
        provider_subject: 'google-no-name',
        provider_email: 'testuser@example.com',
        provider_display_name: null,
        provider_profile_image_url: null,
        last_login_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      } as never);
      mockPrisma.account.findFirst.mockResolvedValue({
        id: BigInt(60),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'testuser@example.com',
        name: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        user_profile: { nickname: 'testuser', profile_image_url: null },
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
        account_id: BigInt(1),
        token_hash: 'hashed-token',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2025-02-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
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
        account_id: BigInt(1),
        token_hash: 'valid-hash',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2030-01-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-01-01'),
        deleted_at: null,
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
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2025-03-01'),
        revoked_at: null,
        replaced_by_session_id: null,
        created_at: new Date('2025-01-15'),
        updated_at: new Date('2025-01-15'),
        deleted_at: null,
      };

      mockPrisma.authRefreshSession.create.mockResolvedValue(newSession);
      mockPrisma.authRefreshSession.update.mockResolvedValue({
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'old-hash',
        revoked_at: expect.any(Date),
        replaced_by_session_id: BigInt(2),
        updated_at: expect.any(Date),
      } as never);

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
      const revokedSession = {
        id: BigInt(1),
        account_id: BigInt(10),
        token_hash: 'some-hash',
        user_agent: 'Mozilla/5.0',
        ip_address: '127.0.0.1',
        expires_at: new Date('2025-06-01'),
        revoked_at: new Date(),
        replaced_by_session_id: null,
        created_at: new Date('2025-01-01'),
        updated_at: new Date(),
        deleted_at: null,
      };

      mockPrisma.authRefreshSession.update.mockResolvedValue(revokedSession);

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

  describe('revokeAllRefreshSessions', () => {
    it('특정 계정의 활성 세션을 모두 revoke해야 한다', async () => {
      // Arrange
      const now = new Date('2025-06-15T10:00:00Z');
      mockPrisma.authRefreshSession.updateMany.mockResolvedValue({ count: 3 });

      // Act
      await repository.revokeAllRefreshSessions(BigInt(10), now);

      // Assert
      expect(mockPrisma.authRefreshSession.updateMany).toHaveBeenCalledWith({
        where: {
          account_id: BigInt(10),
          revoked_at: null,
        },
        data: {
          revoked_at: now,
          updated_at: now,
        },
      });
    });

    it('활성 세션이 없어도 에러 없이 완료해야 한다', async () => {
      // Arrange
      const now = new Date('2025-06-15T10:00:00Z');
      mockPrisma.authRefreshSession.updateMany.mockResolvedValue({ count: 0 });

      // Act & Assert
      await expect(
        repository.revokeAllRefreshSessions(BigInt(999), now),
      ).resolves.toBeUndefined();
    });
  });

  describe('findAccountForMe', () => {
    it('account를 profile과 함께 조회해야 한다', async () => {
      // Arrange
      const account = {
        id: BigInt(1),
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: 'test@example.com',
        name: 'Test User',
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-01'),
        deleted_at: null,
        user_profile: {
          account_id: BigInt(1),
          nickname: 'testuser',
          profile_image_url: 'https://example.com/photo.jpg',
          birth_date: new Date('1990-01-01'),
          phone_number: '010-1234-5678',
        },
      };

      mockPrisma.account.findFirst.mockResolvedValue(account);

      // Act
      const result = await repository.findAccountForMe(BigInt(1));

      // Assert
      expect(result).toEqual(account);
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
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

  describe('findAccountForJwt', () => {
    it('account id, status, account_type만 조회해야 한다', async () => {
      // Arrange
      const account = {
        id: BigInt(1),
        status: 'ACTIVE',
        account_type: AccountType.USER,
      };

      mockPrisma.account.findFirst.mockResolvedValue(account);

      // Act
      const result = await repository.findAccountForJwt(BigInt(1));

      // Assert
      expect(result).toEqual(account);
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        select: { id: true, status: true, account_type: true },
      });
    });
  });

  describe('findSellerCredentialByUsername', () => {
    it('username으로 판매자 자격정보를 조회해야 한다', async () => {
      // Arrange
      const credential = {
        id: BigInt(1),
        seller_account_id: BigInt(20),
        username: 'seller01',
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc123$hashed',
        password_updated_at: new Date('2025-03-01'),
        last_login_at: new Date('2025-06-10'),
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-10'),
        deleted_at: null,
        seller_account: {
          id: BigInt(20),
          account_type: AccountType.SELLER,
          status: 'ACTIVE',
          store: {
            id: BigInt(5),
          },
        },
      };

      mockPrisma.sellerCredential.findFirst.mockResolvedValue(credential);

      // Act
      const result =
        await repository.findSellerCredentialByUsername('seller01');

      // Assert
      expect(result).toEqual(credential);
      expect(mockPrisma.sellerCredential.findFirst).toHaveBeenCalledWith({
        where: { username: 'seller01' },
        include: {
          seller_account: {
            select: {
              id: true,
              account_type: true,
              status: true,
              store: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });
    });

    it('존재하지 않는 username은 null을 반환해야 한다', async () => {
      // Arrange
      mockPrisma.sellerCredential.findFirst.mockResolvedValue(null);

      // Act
      const result =
        await repository.findSellerCredentialByUsername('nonexistent');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findSellerCredentialByAccountId', () => {
    it('계정 ID로 판매자 자격정보를 조회해야 한다', async () => {
      // Arrange
      const credential = {
        id: BigInt(1),
        seller_account_id: BigInt(20),
        username: 'seller01',
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc123$hashed',
        password_updated_at: new Date('2025-03-01'),
        last_login_at: new Date('2025-06-10'),
        created_at: new Date('2025-01-01'),
        updated_at: new Date('2025-06-10'),
        deleted_at: null,
        seller_account: {
          id: BigInt(20),
          account_type: AccountType.SELLER,
          status: 'ACTIVE',
          store: {
            id: BigInt(5),
          },
        },
      };

      mockPrisma.sellerCredential.findFirst.mockResolvedValue(credential);

      // Act
      const result = await repository.findSellerCredentialByAccountId(
        BigInt(20),
      );

      // Assert
      expect(result).toEqual(credential);
      expect(mockPrisma.sellerCredential.findFirst).toHaveBeenCalledWith({
        where: {
          seller_account_id: BigInt(20),
        },
        include: {
          seller_account: {
            select: {
              id: true,
              account_type: true,
              status: true,
              store: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });
    });

    it('존재하지 않는 계정 ID는 null을 반환해야 한다', async () => {
      // Arrange
      mockPrisma.sellerCredential.findFirst.mockResolvedValue(null);

      // Act
      const result = await repository.findSellerCredentialByAccountId(
        BigInt(999),
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('updateSellerLastLogin', () => {
    it('판매자 최근 로그인 시각을 갱신해야 한다', async () => {
      // Arrange
      const now = new Date('2025-06-15T10:30:00Z');
      mockPrisma.sellerCredential.update.mockResolvedValue({
        id: BigInt(1),
        seller_account_id: BigInt(20),
        username: 'seller01',
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$abc123$hashed',
        password_updated_at: new Date('2025-03-01'),
        last_login_at: now,
        created_at: new Date('2025-01-01'),
        updated_at: now,
        deleted_at: null,
      } as never);

      // Act
      await repository.updateSellerLastLogin(BigInt(20), now);

      // Assert
      expect(mockPrisma.sellerCredential.update).toHaveBeenCalledWith({
        where: { seller_account_id: BigInt(20) },
        data: {
          last_login_at: now,
          updated_at: now,
        },
      });
    });
  });

  describe('updateSellerPasswordHash', () => {
    it('판매자 비밀번호 해시를 갱신해야 한다', async () => {
      // Arrange
      const now = new Date('2025-06-15T11:00:00Z');
      const newHash = '$argon2id$v=19$m=65536,t=3,p=4$newSalt$newHash';
      mockPrisma.sellerCredential.update.mockResolvedValue({
        id: BigInt(1),
        seller_account_id: BigInt(20),
        username: 'seller01',
        password_hash: newHash,
        password_updated_at: now,
        last_login_at: new Date('2025-06-15T10:30:00Z'),
        created_at: new Date('2025-01-01'),
        updated_at: now,
        deleted_at: null,
      } as never);

      // Act
      await repository.updateSellerPasswordHash({
        sellerAccountId: BigInt(20),
        passwordHash: newHash,
        now,
      });

      // Assert
      expect(mockPrisma.sellerCredential.update).toHaveBeenCalledWith({
        where: { seller_account_id: BigInt(20) },
        data: {
          password_hash: newHash,
          password_updated_at: now,
          updated_at: now,
        },
      });
    });
  });

  describe('createAuditLog', () => {
    it('감사 로그를 생성해야 한다', async () => {
      // Arrange
      const args = {
        actorAccountId: BigInt(20),
        storeId: BigInt(5),
        targetType: AuditTargetType.CHANGE_PASSWORD,
        targetId: BigInt(20),
        action: AuditActionType.UPDATE,
        beforeJson: null,
        afterJson: { changedAt: '2025-06-15T11:00:00.000Z' },
        ipAddress: '192.168.0.1',
        userAgent: 'Mozilla/5.0',
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: BigInt(100),
        actor_account_id: BigInt(20),
        store_id: BigInt(5),
        target_type: AuditTargetType.CHANGE_PASSWORD,
        target_id: BigInt(20),
        action: AuditActionType.UPDATE,
        before_json: null,
        after_json: { changedAt: '2025-06-15T11:00:00.000Z' },
        ip_address: '192.168.0.1',
        user_agent: 'Mozilla/5.0',
        created_at: new Date('2025-06-15'),
      } as never);

      // Act
      await repository.createAuditLog(args);

      // Assert
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actor_account_id: BigInt(20),
          store_id: BigInt(5),
          target_type: AuditTargetType.CHANGE_PASSWORD,
          target_id: BigInt(20),
          action: AuditActionType.UPDATE,
          before_json: Prisma.JsonNull,
          after_json: { changedAt: '2025-06-15T11:00:00.000Z' },
          ip_address: '192.168.0.1',
          user_agent: 'Mozilla/5.0',
        },
      });
    });

    it('선택 필드가 없으면 null로 저장해야 한다', async () => {
      // Arrange
      const args = {
        actorAccountId: BigInt(20),
        targetType: AuditTargetType.CHANGE_PASSWORD,
        targetId: BigInt(20),
        action: AuditActionType.UPDATE,
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: BigInt(101),
        actor_account_id: BigInt(20),
        store_id: null,
        target_type: AuditTargetType.CHANGE_PASSWORD,
        target_id: BigInt(20),
        action: AuditActionType.UPDATE,
        before_json: null,
        after_json: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2025-06-15'),
      } as never);

      // Act
      await repository.createAuditLog(args);

      // Assert
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actor_account_id: BigInt(20),
          store_id: null,
          target_type: AuditTargetType.CHANGE_PASSWORD,
          target_id: BigInt(20),
          action: AuditActionType.UPDATE,
          before_json: undefined,
          after_json: undefined,
          ip_address: null,
          user_agent: null,
        },
      });
    });

    it('beforeJson과 afterJson이 명시적 null이면 Prisma.JsonNull로 변환해야 한다', async () => {
      // Arrange
      const args = {
        actorAccountId: BigInt(20),
        storeId: null,
        targetType: AuditTargetType.CHANGE_PASSWORD,
        targetId: BigInt(20),
        action: AuditActionType.UPDATE,
        beforeJson: null,
        afterJson: null,
        ipAddress: '10.0.0.1',
        userAgent: 'TestAgent/1.0',
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: BigInt(102),
        actor_account_id: BigInt(20),
        store_id: null,
        target_type: AuditTargetType.CHANGE_PASSWORD,
        target_id: BigInt(20),
        action: AuditActionType.UPDATE,
        before_json: null,
        after_json: null,
        ip_address: '10.0.0.1',
        user_agent: 'TestAgent/1.0',
        created_at: new Date('2025-06-15'),
      } as never);

      // Act
      await repository.createAuditLog(args);

      // Assert
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          before_json: Prisma.JsonNull,
          after_json: Prisma.JsonNull,
        }),
      });
    });
  });
});
