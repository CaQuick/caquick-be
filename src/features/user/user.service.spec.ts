import { Test, TestingModule } from '@nestjs/testing';

import { UserEngagementService } from './services/user-engagement.service';
import { UserNotificationService } from './services/user-notification.service';
import { UserProfileService } from './services/user-profile.service';
import { UserSearchService } from './services/user-search.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let profileService: jest.Mocked<UserProfileService>;
  let notificationService: jest.Mocked<UserNotificationService>;

  beforeEach(async () => {
    profileService = {
      me: jest.fn(),
    } as unknown as jest.Mocked<UserProfileService>;

    notificationService = {
      markNotificationRead: jest.fn(),
    } as unknown as jest.Mocked<UserNotificationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserProfileService,
          useValue: profileService,
        },
        {
          provide: UserNotificationService,
          useValue: notificationService,
        },
        {
          provide: UserSearchService,
          useValue: {},
        },
        {
          provide: UserEngagementService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('me는 UserProfileService로 위임해야 한다', async () => {
    await service.me(BigInt(1));

    expect(profileService.me).toHaveBeenCalledWith(BigInt(1));
  });

  it('markNotificationRead는 UserNotificationService로 위임해야 한다', async () => {
    await service.markNotificationRead(BigInt(1), BigInt(5));

    expect(notificationService.markNotificationRead).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(5),
    );
  });
});
