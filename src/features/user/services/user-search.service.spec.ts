import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRepository } from '../repositories/user.repository';

import { UserSearchService } from './user-search.service';

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
  });
});
