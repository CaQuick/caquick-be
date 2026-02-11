import { Test, TestingModule } from '@nestjs/testing';

import { UserService } from '../user.service';

import { UserMutationResolver } from './user-mutation.resolver';
import { UserQueryResolver } from './user-query.resolver';

describe('UserResolvers', () => {
  let queryResolver: UserQueryResolver;
  let mutationResolver: UserMutationResolver;
  let service: jest.Mocked<UserService>;

  beforeEach(async () => {
    service = {
      me: jest.fn(),
      viewerCounts: jest.fn(),
      myNotifications: jest.fn(),
      mySearchHistories: jest.fn(),
      completeOnboarding: jest.fn(),
      updateMyProfile: jest.fn(),
      updateMyProfileImage: jest.fn(),
      deleteMyAccount: jest.fn(),
      markNotificationRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
      likeReview: jest.fn(),
      deleteSearchHistory: jest.fn(),
      clearSearchHistories: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserQueryResolver,
        UserMutationResolver,
        { provide: UserService, useValue: service },
      ],
    }).compile();

    queryResolver = module.get<UserQueryResolver>(UserQueryResolver);
    mutationResolver = module.get<UserMutationResolver>(UserMutationResolver);
  });

  it('me는 서비스 호출로 연결되어야 한다', async () => {
    const user = { accountId: '1' };
    await queryResolver.me(user);
    expect(service.me).toHaveBeenCalledWith(BigInt(1));
  });

  it('markNotificationRead는 notificationId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '1' };
    await mutationResolver.markNotificationRead(user, '5');
    expect(service.markNotificationRead).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(5),
    );
  });

  it('likeReview는 reviewId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '1' };
    await mutationResolver.likeReview(user, '10');
    expect(service.likeReview).toHaveBeenCalledWith(BigInt(1), BigInt(10));
  });
});
