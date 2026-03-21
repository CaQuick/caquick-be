import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';

import { UserRepository } from '../repositories/user.repository';

import { UserProfileService } from './user-profile.service';

describe('UserProfileService', () => {
  let service: UserProfileService;
  let repo: jest.Mocked<UserRepository>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProfileService,
        { provide: UserRepository, useValue: repo },
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
});
