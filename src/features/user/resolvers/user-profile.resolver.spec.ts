import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserProfileMutationResolver } from '@/features/user/resolvers/user-profile-mutation.resolver';
import { UserProfileQueryResolver } from '@/features/user/resolvers/user-profile-query.resolver';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { S3Service } from '@/global/storage/s3.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createUserProfile } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 전체 경로를 검증하는 통합 테스트.
 * 단위 단계의 상세 분기/예외는 *.service.spec.ts에서 담당하고, 이 파일에서는
 * resolver 어댑터 레이어가 정상적으로 의존성을 배선하는지만 1-2 케이스로 확인한다.
 */
describe('User Profile Resolvers (real DB)', () => {
  let queryResolver: UserProfileQueryResolver;
  let mutationResolver: UserProfileMutationResolver;
  let prisma: PrismaClient;
  let s3Service: jest.Mocked<S3Service>;

  beforeAll(async () => {
    s3Service = {
      createUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;

    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserProfileQueryResolver,
        UserProfileMutationResolver,
        UserProfileService,
        UserRepository,
        { provide: S3Service, useValue: s3Service },
      ],
    });

    queryResolver = module.get(UserProfileQueryResolver);
    mutationResolver = module.get(UserProfileMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
  });

  describe('Query.me', () => {
    it('accountId(string) → BigInt 변환 후 서비스/DB까지 이어져 프로필을 반환한다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        email: 'user@example.com',
        name: '길동',
      });
      await createUserProfile(prisma, {
        account_id: account.id,
        nickname: 'gildong',
      });

      const result = await queryResolver.me({
        accountId: account.id.toString(),
      });

      expect(result.accountId).toBe(account.id.toString());
      expect(result.profile.nickname).toBe('gildong');
    });

    it('존재하지 않는 accountId면 서비스 에러를 그대로 전파한다', async () => {
      await expect(queryResolver.me({ accountId: '999999' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Mutation.updateMyProfile', () => {
    it('프로필 업데이트 요청이 DB에 반영된다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await mutationResolver.updateMyProfile(
        { accountId: account.id.toString() },
        { nickname: 'newNick' },
      );

      expect(result.profile.nickname).toBe('newNick');

      const saved = await prisma.userProfile.findUniqueOrThrow({
        where: { account_id: account.id },
      });
      expect(saved.nickname).toBe('newNick');
    });

    it('닉네임 중복은 ConflictException으로 전파된다', async () => {
      const other = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: other.id,
        nickname: 'taken',
      });

      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: me.id });

      await expect(
        mutationResolver.updateMyProfile(
          { accountId: me.id.toString() },
          { nickname: 'taken' },
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Mutation.deleteMyAccount', () => {
    it('resolver → service 경로로 soft-delete가 수행된다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        email: 'del@example.com',
      });
      await createUserProfile(prisma, { account_id: account.id });

      const ok = await mutationResolver.deleteMyAccount({
        accountId: account.id.toString(),
      });

      expect(ok).toBe(true);
      const deleted = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(deleted.deleted_at).not.toBeNull();
    });
  });

  describe('Mutation.createProfileImageUploadUrl', () => {
    it('S3 mock 결과를 그대로 반환한다 (요청 시점에 계정 활성 검증 수행)', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const expected = {
        uploadUrl: 'https://presigned.example.com',
        publicUrl: 'https://s3.example.com/x.jpg',
        key: 'profile-images/x/uuid.jpg',
        expiresInSeconds: 600,
      };
      s3Service.createUploadUrl.mockResolvedValue(expected);

      const result = await mutationResolver.createProfileImageUploadUrl(
        { accountId: account.id.toString() },
        { contentType: 'image/jpeg', contentLength: 1024 },
      );

      expect(result).toEqual(expected);
      expect(s3Service.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: account.id,
          purpose: 'PROFILE_IMAGE',
        }),
      );
    });
  });
});
