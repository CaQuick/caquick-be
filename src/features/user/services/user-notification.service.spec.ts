import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserNotificationService } from '@/features/user/services/user-notification.service';

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

  describe('viewerCounts', () => {
    it('뷰어 카운트를 반환해야 한다', async () => {
      const mockCounts = { unreadNotificationCount: 3 };
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.getViewerCounts.mockResolvedValue(mockCounts as never);

      const result = await service.viewerCounts(BigInt(1));

      expect(result).toEqual(mockCounts);
      expect(repo.getViewerCounts).toHaveBeenCalledWith(BigInt(1));
    });

    it('계정이 없으면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(null);

      await expect(service.viewerCounts(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('myNotifications', () => {
    it('알림 목록과 hasMore를 올바르게 반환해야 한다', async () => {
      const now = new Date();
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.listNotifications.mockResolvedValue({
        items: [
          {
            id: BigInt(1),
            type: 'SYSTEM',
            title: '공지사항',
            body: '내용입니다',
            read_at: null,
            created_at: now,
          },
        ],
        totalCount: 25,
      } as never);

      const result = await service.myNotifications(BigInt(1), {
        offset: 0,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('1');
      expect(result.items[0].title).toBe('공지사항');
      expect(result.totalCount).toBe(25);
      expect(result.hasMore).toBe(true);
    });

    it('마지막 페이지면 hasMore가 false여야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.listNotifications.mockResolvedValue({
        items: [],
        totalCount: 5,
      });

      const result = await service.myNotifications(BigInt(1), {
        offset: 0,
        limit: 10,
      });

      expect(result.hasMore).toBe(false);
    });
  });

  describe('markAllNotificationsRead', () => {
    it('모든 알림을 읽음 처리하고 true를 반환해야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.markAllNotificationsRead.mockResolvedValue(undefined as never);

      const result = await service.markAllNotificationsRead(BigInt(1));

      expect(result).toBe(true);
      expect(repo.markAllNotificationsRead).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: BigInt(1) }),
      );
    });
  });

  describe('markNotificationRead', () => {
    it('읽음 처리 성공 시 true를 반환해야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(baseAccount);
      repo.markNotificationRead.mockResolvedValue(true);

      const result = await service.markNotificationRead(BigInt(1), BigInt(10));

      expect(result).toBe(true);
    });
  });
});
