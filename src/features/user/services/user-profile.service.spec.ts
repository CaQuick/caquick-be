import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { S3Service } from '@/global/storage/s3.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createUserProfile } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserProfileService (real DB)', () => {
  let service: UserProfileService;
  let prisma: PrismaClient;
  let s3Service: jest.Mocked<S3Service>;

  beforeAll(async () => {
    s3Service = {
      createUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;

    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserProfileService,
        UserRepository,
        { provide: S3Service, useValue: s3Service },
      ],
    });

    service = module.get(UserProfileService);
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

  // ─── me ───
  describe('me', () => {
    it('활성 USER의 프로필 정보를 MePayload로 반환한다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        email: 'me@example.com',
        name: '홍길동',
      });
      await createUserProfile(prisma, {
        account_id: account.id,
        nickname: 'gildong',
      });

      const result = await service.me(account.id);

      expect(result).toMatchObject({
        accountId: account.id.toString(),
        email: 'me@example.com',
        name: '홍길동',
        accountType: 'USER',
        profile: { nickname: 'gildong' },
      });
    });

    it('계정이 없으면 UnauthorizedException을 던진다', async () => {
      await expect(service.me(BigInt(999999))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── completeOnboarding ───
  describe('completeOnboarding', () => {
    it('이름 미존재 + 입력 이름이 있으면 Account.name과 프로필을 갱신한다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        name: null,
      });
      await createUserProfile(prisma, {
        account_id: account.id,
        onboarding_completed_at: null,
      });

      const result = await service.completeOnboarding(account.id, {
        name: '홍길동',
        nickname: 'gildong1',
        birthDate: new Date('1990-01-01'),
        phoneNumber: '010-1234-5678',
      });

      expect(result.name).toBe('홍길동');
      expect(result.profile.nickname).toBe('gildong1');
      expect(result.profile.onboardingCompletedAt).toBeInstanceOf(Date);

      const saved = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(saved.name).toBe('홍길동');
    });

    it('이미 Account.name이 존재하면 입력 name은 무시되고 기존 이름을 유지한다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        name: '기존이름',
      });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await service.completeOnboarding(account.id, {
        nickname: 'newNick',
        name: '새이름',
      });

      expect(result.name).toBe('기존이름');
    });

    it('Account.name과 입력 name이 모두 없으면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        name: null,
      });
      await createUserProfile(prisma, { account_id: account.id });

      await expect(
        service.completeOnboarding(account.id, {
          nickname: 'newNick',
          name: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('닉네임이 이미 다른 계정에서 사용 중이면 ConflictException을 던진다', async () => {
      const other = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: other.id,
        nickname: 'takenNick',
      });

      const me = await createAccount(prisma, {
        account_type: 'USER',
        name: '길동',
      });
      await createUserProfile(prisma, { account_id: me.id });

      await expect(
        service.completeOnboarding(me.id, { nickname: 'takenNick' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── updateMyProfile ───
  describe('updateMyProfile', () => {
    it('변경할 필드가 하나도 없으면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      await expect(service.updateMyProfile(account.id, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('birthDate만 단독 업데이트한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: account.id,
        birth_date: null,
      });

      const result = await service.updateMyProfile(account.id, {
        birthDate: new Date('1995-03-20'),
      });

      expect(result.profile.birthDate).toBeInstanceOf(Date);
      expect((result.profile.birthDate as Date).getFullYear()).toBe(1995);
    });

    it('phoneNumber만 단독 업데이트한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: account.id,
        phone_number: null,
      });

      const result = await service.updateMyProfile(account.id, {
        phoneNumber: '010-9999-8888',
      });

      expect(result.profile.phoneNumber).toBe('010-9999-8888');
    });

    it('사용 가능한 닉네임으로 변경한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: account.id,
        nickname: 'oldNick',
      });

      const result = await service.updateMyProfile(account.id, {
        nickname: 'newNick',
      });

      expect(result.profile.nickname).toBe('newNick');
    });

    it('닉네임이 다른 계정에서 이미 쓰이면 ConflictException을 던진다', async () => {
      const other = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: other.id,
        nickname: 'taken',
      });

      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: me.id });

      await expect(
        service.updateMyProfile(me.id, { nickname: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── updateMyProfileImage ───
  describe('updateMyProfileImage', () => {
    it('유효한 URL이면 프로필 이미지를 업데이트한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await service.updateMyProfileImage(account.id, {
        profileImageUrl: 'https://s3.example.com/profile.jpg',
      });

      expect(result.profile.profileImageUrl).toBe(
        'https://s3.example.com/profile.jpg',
      );
    });

    it('URL이 공백-only면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      await expect(
        service.updateMyProfileImage(account.id, { profileImageUrl: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('URL이 2048자를 초과하면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      await expect(
        service.updateMyProfileImage(account.id, {
          profileImageUrl: 'https://s3.example.com/' + 'a'.repeat(2030),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── checkNicknameAvailability ───
  describe('checkNicknameAvailability', () => {
    it('사용 가능한 닉네임이면 available: true', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await service.checkNicknameAvailability(
        'freshNick',
        account.id,
      );

      expect(result).toEqual({ available: true, reason: null });
    });

    it('이미 사용 중인 닉네임이면 available: false + 사유 반환', async () => {
      const other = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: other.id,
        nickname: 'takenNick',
      });

      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: me.id });

      const result = await service.checkNicknameAvailability(
        'takenNick',
        me.id,
      );

      expect(result.available).toBe(false);
      expect(result.reason).toContain('이미 사용 중');
    });

    it('자기 자신이 이미 쓰고 있는 닉네임은 사용 가능으로 판정한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: account.id,
        nickname: 'myNick',
      });

      const result = await service.checkNicknameAvailability(
        'myNick',
        account.id,
      );

      expect(result.available).toBe(true);
    });

    it('너무 짧으면 available: false + 길이 사유', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await service.checkNicknameAvailability('a', account.id);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('2~20자');
    });

    it('특수문자가 포함되면 available: false + 문자 사유', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await service.checkNicknameAvailability(
        'nick@name',
        account.id,
      );

      expect(result.available).toBe(false);
      expect(result.reason).toContain('한글');
    });
  });

  // ─── createProfileImageUploadUrl (S3 mock 유지) ───
  describe('createProfileImageUploadUrl', () => {
    it('S3Service.createUploadUrl에 PROFILE_IMAGE purpose로 위임한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const uploadResult = {
        uploadUrl: 'https://presigned.example.com',
        publicUrl: 'https://s3.example.com/profile.jpg',
        key: 'profile-images/x/2026-04-21/uuid.jpg',
        expiresInSeconds: 600,
      };
      s3Service.createUploadUrl.mockResolvedValue(uploadResult);

      const result = await service.createProfileImageUploadUrl(account.id, {
        contentType: 'image/jpeg',
        contentLength: 1024 * 1024,
      });

      expect(result).toEqual(uploadResult);
      expect(s3Service.createUploadUrl).toHaveBeenCalledWith({
        accountId: account.id,
        purpose: 'PROFILE_IMAGE',
        contentType: 'image/jpeg',
        contentLength: 1024 * 1024,
      });
    });
  });

  // ─── deleteMyAccount ───
  describe('deleteMyAccount', () => {
    it('계정/프로필을 soft delete하고 닉네임은 deleted_{id}로 치환한다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        email: 'delete@example.com',
      });
      await createUserProfile(prisma, {
        account_id: account.id,
        nickname: 'preDelete',
      });

      const result = await service.deleteMyAccount(account.id);

      expect(result).toBe(true);

      const deletedAccount = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(deletedAccount.deleted_at).toBeInstanceOf(Date);
      expect(deletedAccount.email).toBeNull();

      const deletedProfile = await prisma.userProfile.findUniqueOrThrow({
        where: { account_id: account.id },
      });
      expect(deletedProfile.deleted_at).toBeInstanceOf(Date);
      expect(deletedProfile.nickname).toBe(`deleted_${account.id.toString()}`);
    });

    it('삭제된 계정은 이후 me() 호출 시 UnauthorizedException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      await service.deleteMyAccount(account.id);

      await expect(service.me(account.id)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
