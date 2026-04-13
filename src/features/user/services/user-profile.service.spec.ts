import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { S3Service } from '@/global/storage/s3.service';

describe('UserProfileService', () => {
  let service: UserProfileService;
  let repo: jest.Mocked<UserRepository>;
  let s3Service: jest.Mocked<S3Service>;

  const baseAccount = {
    id: BigInt(1),
    account_type: AccountType.USER,
    email: 'test@example.com',
    name: 'Test User',
    deleted_at: null,
    user_profile: {
      nickname: 'tester',
      birth_date: null,
      phone_number: null,
      profile_image_url: null,
      onboarding_completed_at: null,
      deleted_at: null,
    },
  };

  beforeEach(async () => {
    repo = {
      findAccountWithProfile: jest.fn(),
      isNicknameTaken: jest.fn(),
      completeOnboarding: jest.fn(),
      updateProfile: jest.fn(),
      updateProfileImage: jest.fn(),
      softDeleteAccount: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    s3Service = {
      createUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProfileService,
        { provide: UserRepository, useValue: repo },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get<UserProfileService>(UserProfileService);
  });

  it('me는 인증된 유저 정보를 반환해야 한다', async () => {
    repo.findAccountWithProfile.mockResolvedValue(baseAccount);

    const result = await service.me(BigInt(1));

    expect(result).toEqual({
      accountId: '1',
      email: 'test@example.com',
      name: 'Test User',
      accountType: AccountType.USER,
      profile: {
        nickname: 'tester',
        birthDate: null,
        phoneNumber: null,
        profileImageUrl: null,
        onboardingCompletedAt: null,
      },
    });
  });

  it('계정이 없으면 UnauthorizedException을 던져야 한다', async () => {
    repo.findAccountWithProfile.mockResolvedValue(null);

    await expect(service.me(BigInt(1))).rejects.toThrow(UnauthorizedException);
  });

  it('닉네임이 중복이면 ConflictException을 던져야 한다', async () => {
    repo.findAccountWithProfile.mockResolvedValue(baseAccount);
    repo.isNicknameTaken.mockResolvedValue(true);

    await expect(
      service.updateMyProfile(BigInt(1), { nickname: 'tester2' }),
    ).rejects.toThrow(ConflictException);
  });

  it('deleteMyAccount는 soft delete를 수행해야 한다', async () => {
    repo.findAccountWithProfile.mockResolvedValue(baseAccount);

    const result = await service.deleteMyAccount(BigInt(1));

    expect(result).toBe(true);
    expect(repo.softDeleteAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: BigInt(1),
        deletedNickname: 'deleted_1',
      }),
    );
  });

  describe('checkNicknameAvailability', () => {
    beforeEach(() => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
    });

    it('사용 가능한 닉네임이면 available: true를 반환해야 한다', async () => {
      repo.isNicknameTaken.mockResolvedValue(false);

      const result = await service.checkNicknameAvailability(
        'newNick',
        BigInt(1),
      );

      expect(result).toEqual({ available: true, reason: null });
    });

    it('이미 사용 중인 닉네임이면 available: false를 반환해야 한다', async () => {
      repo.isNicknameTaken.mockResolvedValue(true);

      const result = await service.checkNicknameAvailability(
        'takenNick',
        BigInt(1),
      );

      expect(result.available).toBe(false);
      expect(result.reason).toContain('이미 사용 중');
    });

    it('닉네임이 너무 짧으면 available: false를 반환해야 한다', async () => {
      const result = await service.checkNicknameAvailability('a', BigInt(1));

      expect(result.available).toBe(false);
      expect(result.reason).toContain('2~20자');
    });

    it('닉네임에 특수문자가 포함되면 available: false를 반환해야 한다', async () => {
      const result = await service.checkNicknameAvailability(
        'nick@name',
        BigInt(1),
      );

      expect(result.available).toBe(false);
      expect(result.reason).toContain('한글, 영문, 숫자, 언더스코어');
    });
  });

  describe('completeOnboarding', () => {
    it('온보딩을 완료하고 프로필을 반환해야 한다', async () => {
      const accountWithoutName = { ...baseAccount, name: null };
      repo.findAccountWithProfile
        .mockResolvedValueOnce(accountWithoutName)
        .mockResolvedValueOnce(baseAccount);
      repo.isNicknameTaken.mockResolvedValue(false);
      repo.completeOnboarding.mockResolvedValue(undefined as never);

      const result = await service.completeOnboarding(BigInt(1), {
        name: '홍길동',
        nickname: 'newNick',
        birthDate: new Date('1990-01-01'),
        phoneNumber: '010-1234-5678',
      });

      expect(repo.completeOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: BigInt(1),
          name: '홍길동',
          nickname: 'newNick',
        }),
      );
      expect(result.accountId).toBe('1');
    });

    it('계정에 이름이 이미 있으면 name 필드를 null로 전달해야 한다', async () => {
      // baseAccount에는 name: 'Test User'가 있음
      repo.findAccountWithProfile
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce(baseAccount);
      repo.isNicknameTaken.mockResolvedValue(false);
      repo.completeOnboarding.mockResolvedValue(undefined as never);

      await service.completeOnboarding(BigInt(1), {
        nickname: 'newNick',
        name: '새이름',
      });

      expect(repo.completeOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({ name: null }),
      );
    });

    it('계정에 이름이 없고 input에도 이름이 없으면 BadRequestException을 던져야 한다', async () => {
      const accountWithoutName = { ...baseAccount, name: null };
      repo.findAccountWithProfile.mockResolvedValue(accountWithoutName);

      await expect(
        service.completeOnboarding(BigInt(1), {
          nickname: 'newNick',
          name: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('닉네임이 중복이면 ConflictException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.isNicknameTaken.mockResolvedValue(true);

      await expect(
        service.completeOnboarding(BigInt(1), {
          nickname: 'taken',
          name: '홍길동',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateMyProfile', () => {
    it('업데이트 필드가 없으면 BadRequestException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);

      await expect(service.updateMyProfile(BigInt(1), {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('birthDate만 업데이트하면 성공해야 한다', async () => {
      repo.findAccountWithProfile
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce(baseAccount);
      repo.updateProfile.mockResolvedValue(undefined as never);

      const result = await service.updateMyProfile(BigInt(1), {
        birthDate: new Date('1990-06-15'),
      });

      expect(repo.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: BigInt(1),
          birthDate: expect.any(Date),
        }),
      );
      expect(result.accountId).toBe('1');
    });

    it('phoneNumber만 업데이트하면 성공해야 한다', async () => {
      repo.findAccountWithProfile
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce(baseAccount);
      repo.updateProfile.mockResolvedValue(undefined as never);

      await service.updateMyProfile(BigInt(1), {
        phoneNumber: '010-9999-8888',
      });

      expect(repo.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: '010-9999-8888' }),
      );
    });

    it('닉네임이 undefined가 아니지만 중복 아니면 성공해야 한다', async () => {
      repo.findAccountWithProfile
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce(baseAccount);
      repo.isNicknameTaken.mockResolvedValue(false);
      repo.updateProfile.mockResolvedValue(undefined as never);

      await service.updateMyProfile(BigInt(1), { nickname: 'uniqueNick' });

      expect(repo.isNicknameTaken).toHaveBeenCalledWith(
        'uniqueNick',
        BigInt(1),
      );
      expect(repo.updateProfile).toHaveBeenCalled();
    });
  });

  describe('updateMyProfileImage', () => {
    it('유효한 URL이면 프로필 이미지를 업데이트해야 한다', async () => {
      repo.findAccountWithProfile
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce(baseAccount);
      repo.updateProfileImage.mockResolvedValue(undefined as never);

      const result = await service.updateMyProfileImage(BigInt(1), {
        profileImageUrl: 'https://s3.example.com/profile.jpg',
      });

      expect(repo.updateProfileImage).toHaveBeenCalledWith({
        accountId: BigInt(1),
        profileImageUrl: 'https://s3.example.com/profile.jpg',
      });
      expect(result.accountId).toBe('1');
    });

    it('URL이 빈 문자열이면 BadRequestException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);

      await expect(
        service.updateMyProfileImage(BigInt(1), { profileImageUrl: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('URL이 2048자 초과이면 BadRequestException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);

      await expect(
        service.updateMyProfileImage(BigInt(1), {
          profileImageUrl: 'https://s3.example.com/' + 'a'.repeat(2030),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createProfileImageUploadUrl', () => {
    beforeEach(() => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
    });

    it('S3Service에 PROFILE_IMAGE purpose로 위임해야 한다', async () => {
      const mockResult = {
        uploadUrl: 'https://presigned-url.com',
        publicUrl: 'https://s3.example.com/profile.jpg',
        key: 'profile-images/1/2026-04-13/uuid.jpg',
        expiresInSeconds: 600,
      };
      s3Service.createUploadUrl.mockResolvedValue(mockResult);

      const result = await service.createProfileImageUploadUrl(BigInt(1), {
        contentType: 'image/jpeg',
        contentLength: 1024 * 1024,
      });

      expect(result).toEqual(mockResult);
      expect(s3Service.createUploadUrl).toHaveBeenCalledWith({
        accountId: BigInt(1),
        purpose: 'PROFILE_IMAGE',
        contentType: 'image/jpeg',
        contentLength: 1024 * 1024,
      });
    });
  });
});
