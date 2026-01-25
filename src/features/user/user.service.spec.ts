import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';

import { UserRepository } from './repositories/user.repository';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
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
      getViewerCounts: jest.fn(),
      listNotifications: jest.fn(),
      markNotificationRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
      listSearchHistories: jest.fn(),
      deleteSearchHistory: jest.fn(),
      clearSearchHistories: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserService, { provide: UserRepository, useValue: repo }],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('me', () => {
    it('인증된 유저 정보를 반환해야 한다', async () => {
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

      await expect(service.me(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('삭제된 계정이면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue({
        ...baseAccount,
        deleted_at: new Date(),
      });

      await expect(service.me(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('updateMyProfile', () => {
    it('닉네임이 중복이면 ConflictException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.isNicknameTaken.mockResolvedValue(true);

      await expect(
        service.updateMyProfile(BigInt(1), { nickname: 'tester2' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('myNotifications', () => {
    it('unreadOnly 옵션을 전달해야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.listNotifications.mockResolvedValue({ items: [], totalCount: 0 });

      await service.myNotifications(BigInt(1), {
        unreadOnly: true,
        offset: 0,
        limit: 10,
      });

      expect(repo.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ unreadOnly: true }),
      );
    });
  });

  describe('deleteMyAccount', () => {
    it('soft delete를 수행해야 한다', async () => {
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

  describe('deleteSearchHistory', () => {
    it('존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.deleteSearchHistory.mockResolvedValue(false);

      await expect(
        service.deleteSearchHistory(BigInt(1), BigInt(99)),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
