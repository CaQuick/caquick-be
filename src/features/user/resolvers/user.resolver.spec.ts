import { Test, TestingModule } from '@nestjs/testing';

import { UserNotificationMutationResolver } from '@/features/user/resolvers/user-notification-mutation.resolver';
import { UserProfileQueryResolver } from '@/features/user/resolvers/user-profile-query.resolver';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { UserProfileService } from '@/features/user/services/user-profile.service';

describe('UserResolvers', () => {
  let queryResolver: UserProfileQueryResolver;
  let mutationResolver: UserNotificationMutationResolver;
  let profileService: jest.Mocked<UserProfileService>;
  let notificationService: jest.Mocked<UserNotificationService>;

  beforeEach(async () => {
    profileService = {
      me: jest.fn(),
    } as unknown as jest.Mocked<UserProfileService>;

    notificationService = {
      markNotificationRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
    } as unknown as jest.Mocked<UserNotificationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProfileQueryResolver,
        UserNotificationMutationResolver,
        { provide: UserProfileService, useValue: profileService },
        { provide: UserNotificationService, useValue: notificationService },
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
    expect(profileService.me).toHaveBeenCalledWith(BigInt(1));
  });

  it('markNotificationRead는 notificationId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '1' };
    await mutationResolver.markNotificationRead(user, '5');
    expect(notificationService.markNotificationRead).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(5),
    );
  });

  it('markAllNotificationsRead는 accountId를 전달해야 한다', async () => {
    const user = { accountId: '1' };
    await mutationResolver.markAllNotificationsRead(user);
    expect(notificationService.markAllNotificationsRead).toHaveBeenCalledWith(
      BigInt(1),
    );
  });
});
