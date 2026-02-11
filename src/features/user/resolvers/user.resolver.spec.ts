import { Test, TestingModule } from '@nestjs/testing';

import { UserService } from '../user.service';

import { UserNotificationMutationResolver } from './user-notification-mutation.resolver';
import { UserProfileQueryResolver } from './user-profile-query.resolver';

describe('UserResolvers', () => {
  let queryResolver: UserProfileQueryResolver;
  let mutationResolver: UserNotificationMutationResolver;
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
        UserProfileQueryResolver,
        UserNotificationMutationResolver,
        { provide: UserService, useValue: service },
      ],
    }).compile();

    queryResolver = module.get<UserProfileQueryResolver>(
      UserProfileQueryResolver,
    );
    mutationResolver = module.get<UserNotificationMutationResolver>(
      UserNotificationMutationResolver,
    );
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

  it('markAllNotificationsRead는 accountId를 전달해야 한다', async () => {
    const user = { accountId: '1' };
    await mutationResolver.markAllNotificationsRead(user);
    expect(service.markAllNotificationsRead).toHaveBeenCalledWith(BigInt(1));
  });
});
