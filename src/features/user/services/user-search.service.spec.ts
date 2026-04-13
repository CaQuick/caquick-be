import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserSearchService } from '@/features/user/services/user-search.service';

const USER_CONTEXT = {
  id: BigInt(1),
  deleted_at: null,
  account_type: 'USER',
  status: 'ACTIVE',
  user_profile: {
    deleted_at: null,
    nickname: 'test',
    birth_date: null,
    phone_number: null,
    profile_image_url: null,
    onboarding_completed_at: null,
  },
};

describe('UserSearchService', () => {
  let service: UserSearchService;
  let repo: jest.Mocked<UserRepository>;

  beforeEach(async () => {
    repo = {
      findAccountWithProfile: jest.fn(),
      listSearchHistories: jest.fn(),
      deleteSearchHistory: jest.fn(),
      clearSearchHistories: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSearchService,
        {
          provide: UserRepository,
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<UserSearchService>(UserSearchService);
  });

  describe('mySearchHistories', () => {
    it('검색 기록 목록과 hasMore를 올바르게 반환해야 한다', async () => {
      const now = new Date();
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.listSearchHistories.mockResolvedValue({
        items: [
          {
            id: BigInt(1),
            keyword: '딸기 케이크',
            last_used_at: now,
          },
        ],
        totalCount: 30,
      } as never);

      const result = await service.mySearchHistories(BigInt(1), {
        offset: 0,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('1');
      expect(result.items[0].keyword).toBe('딸기 케이크');
      expect(result.totalCount).toBe(30);
      expect(result.hasMore).toBe(true);
    });

    it('마지막 페이지이면 hasMore가 false여야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.listSearchHistories.mockResolvedValue({
        items: [],
        totalCount: 5,
      } as never);

      const result = await service.mySearchHistories(BigInt(1), {
        offset: 0,
        limit: 10,
      });

      expect(result.hasMore).toBe(false);
    });

    it('계정이 없으면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(null);

      await expect(service.mySearchHistories(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('deleteSearchHistory', () => {
    it('검색 기록이 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.deleteSearchHistory.mockResolvedValue(null as never);

      await expect(
        service.deleteSearchHistory(BigInt(1), BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상적으로 삭제하면 true를 반환해야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.deleteSearchHistory.mockResolvedValue({ id: BigInt(1) } as never);

      const result = await service.deleteSearchHistory(BigInt(1), BigInt(10));
      expect(result).toBe(true);
    });
  });

  describe('clearSearchHistories', () => {
    it('정상적으로 전체 삭제하면 true를 반환해야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.clearSearchHistories.mockResolvedValue(undefined as never);

      const result = await service.clearSearchHistories(BigInt(1));
      expect(result).toBe(true);
    });

    it('계정이 유효하지 않으면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(null);

      await expect(service.clearSearchHistories(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repo.clearSearchHistories).not.toHaveBeenCalled();
    });
  });
});
