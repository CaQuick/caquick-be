import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';

import { UserRepository } from '../repositories/user.repository';

import { UserNotificationService } from './user-notification.service';

describe('UserNotificationService', () => {
  let service: UserNotificationService;
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
      listNotifications: jest.fn(),
      markNotificationRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
      getViewerCounts: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserNotificationService,
        { provide: UserRepository, useValue: repo },
      ],
    }).compile();

    service = module.get<UserNotificationService>(UserNotificationService);
  });

  it('myNotifications는 unreadOnly 옵션을 전달해야 한다', async () => {
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

  it('markNotificationRead 대상이 없으면 NotFoundException을 던져야 한다', async () => {
    repo.findAccountWithProfile.mockResolvedValue(baseAccount);
    repo.markNotificationRead.mockResolvedValue(false);

    await expect(
      service.markNotificationRead(BigInt(1), BigInt(99)),
    ).rejects.toThrow(NotFoundException);
  });
});
