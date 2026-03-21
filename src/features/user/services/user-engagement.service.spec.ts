import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';

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

describe('UserEngagementService', () => {
  let service: UserEngagementService;
  let repo: jest.Mocked<UserRepository>;

  beforeEach(async () => {
    repo = {
      findAccountWithProfile: jest.fn(),
      likeReview: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEngagementService,
        {
          provide: UserRepository,
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<UserEngagementService>(UserEngagementService);
  });

  describe('likeReview', () => {
    it('리뷰가 존재하지 않으면 NotFoundException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.likeReview.mockResolvedValue('not-found');

      await expect(service.likeReview(BigInt(1), BigInt(999))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('자기 리뷰에 좋아요 시 BadRequestException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.likeReview.mockResolvedValue('self-like');

      await expect(service.likeReview(BigInt(1), BigInt(10))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('정상적으로 좋아요하면 true를 반환해야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(USER_CONTEXT as never);
      repo.likeReview.mockResolvedValue('ok' as never);

      const result = await service.likeReview(BigInt(1), BigInt(10));
      expect(result).toBe(true);
    });
  });
});
