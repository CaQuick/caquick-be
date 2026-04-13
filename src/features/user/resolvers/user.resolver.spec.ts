import { Test, TestingModule } from '@nestjs/testing';

import { UserEngagementMutationResolver } from '@/features/user/resolvers/user-engagement-mutation.resolver';
import { UserMypageQueryResolver } from '@/features/user/resolvers/user-mypage-query.resolver';
import { UserNotificationMutationResolver } from '@/features/user/resolvers/user-notification-mutation.resolver';
import { UserNotificationQueryResolver } from '@/features/user/resolvers/user-notification-query.resolver';
import { UserOrderQueryResolver } from '@/features/user/resolvers/user-order-query.resolver';
import { UserProfileMutationResolver } from '@/features/user/resolvers/user-profile-mutation.resolver';
import { UserProfileQueryResolver } from '@/features/user/resolvers/user-profile-query.resolver';
import { UserRecentViewMutationResolver } from '@/features/user/resolvers/user-recent-view-mutation.resolver';
import { UserRecentViewQueryResolver } from '@/features/user/resolvers/user-recent-view-query.resolver';
import { UserReviewMutationResolver } from '@/features/user/resolvers/user-review-mutation.resolver';
import { UserReviewQueryResolver } from '@/features/user/resolvers/user-review-query.resolver';
import { UserSearchMutationResolver } from '@/features/user/resolvers/user-search-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/user/resolvers/user-search-query.resolver';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import { UserMypageService } from '@/features/user/services/user-mypage.service';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { UserOrderService } from '@/features/user/services/user-order.service';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import { UserReviewService } from '@/features/user/services/user-review.service';
import { UserSearchService } from '@/features/user/services/user-search.service';
import type {
  CompleteOnboardingInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from '@/features/user/types/user-input.type';
import type {
  MePayload,
  NotificationConnection,
  SearchHistoryConnection,
  ViewerCounts,
} from '@/features/user/types/user-output.type';

// ---------------------------------------------------------------------------
// 공통 mock 데이터
// ---------------------------------------------------------------------------

const mockMePayload: MePayload = {
  accountId: '1',
  email: 'test@example.com',
  name: 'Test User',
  accountType: 'USER',
  profile: {
    nickname: 'tester',
    birthDate: null,
    phoneNumber: null,
    profileImageUrl: null,
    onboardingCompletedAt: null,
  },
};

const mockViewerCounts: ViewerCounts = {
  unreadNotificationCount: 3,
  cartItemCount: 2,
  wishlistCount: 5,
};

const mockNotificationConnection: NotificationConnection = {
  items: [
    {
      id: '10',
      type: 'SYSTEM',
      title: 'Welcome',
      body: 'Welcome to CaQuick!',
      readAt: null,
      createdAt: new Date('2026-01-01'),
    },
  ],
  totalCount: 1,
  hasMore: false,
};

const mockSearchHistoryConnection: SearchHistoryConnection = {
  items: [
    {
      id: '20',
      keyword: 'coffee',
      lastUsedAt: new Date('2026-01-01'),
    },
  ],
  totalCount: 1,
  hasMore: false,
};

// ---------------------------------------------------------------------------
// UserProfileQueryResolver
// ---------------------------------------------------------------------------

describe('UserProfileQueryResolver', () => {
  let resolver: UserProfileQueryResolver;
  let profileService: jest.Mocked<UserProfileService>;

  beforeEach(async () => {
    profileService = {
      me: jest.fn(),
    } as unknown as jest.Mocked<UserProfileService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProfileQueryResolver,
        { provide: UserProfileService, useValue: profileService },
      ],
    }).compile();

    resolver = module.get<UserProfileQueryResolver>(UserProfileQueryResolver);
  });

  it('me는 accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    profileService.me.mockResolvedValue(mockMePayload);

    const user = { accountId: '1' };
    const result = await resolver.me(user);

    expect(profileService.me).toHaveBeenCalledWith(BigInt(1));
    expect(result).toBe(mockMePayload);
  });

  it('me는 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('User not found');
    profileService.me.mockRejectedValue(error);

    const user = { accountId: '1' };
    await expect(resolver.me(user)).rejects.toThrow(error);
  });
});

// ---------------------------------------------------------------------------
// UserProfileMutationResolver
// ---------------------------------------------------------------------------

describe('UserProfileMutationResolver', () => {
  let resolver: UserProfileMutationResolver;
  let profileService: jest.Mocked<UserProfileService>;

  beforeEach(async () => {
    profileService = {
      completeOnboarding: jest.fn(),
      updateMyProfile: jest.fn(),
      updateMyProfileImage: jest.fn(),
      deleteMyAccount: jest.fn(),
    } as unknown as jest.Mocked<UserProfileService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProfileMutationResolver,
        { provide: UserProfileService, useValue: profileService },
      ],
    }).compile();

    resolver = module.get<UserProfileMutationResolver>(
      UserProfileMutationResolver,
    );
  });

  it('completeOnboarding은 accountId를 BigInt로 변환하고 input을 서비스에 전달해야 한다', async () => {
    profileService.completeOnboarding.mockResolvedValue(mockMePayload);

    const user = { accountId: '1' };
    const input: CompleteOnboardingInput = {
      nickname: 'newbie',
      name: 'New User',
      birthDate: new Date('1990-01-01'),
      phoneNumber: '010-1234-5678',
    };

    const result = await resolver.completeOnboarding(user, input);

    expect(profileService.completeOnboarding).toHaveBeenCalledWith(
      BigInt(1),
      input,
    );
    expect(result).toBe(mockMePayload);
  });

  it('updateMyProfile은 accountId를 BigInt로 변환하고 input을 서비스에 전달해야 한다', async () => {
    profileService.updateMyProfile.mockResolvedValue(mockMePayload);

    const user = { accountId: '2' };
    const input: UpdateMyProfileInput = { nickname: 'updated' };

    const result = await resolver.updateMyProfile(user, input);

    expect(profileService.updateMyProfile).toHaveBeenCalledWith(
      BigInt(2),
      input,
    );
    expect(result).toBe(mockMePayload);
  });

  it('updateMyProfileImage는 accountId를 BigInt로 변환하고 input을 서비스에 전달해야 한다', async () => {
    profileService.updateMyProfileImage.mockResolvedValue(mockMePayload);

    const user = { accountId: '3' };
    const input: UpdateMyProfileImageInput = {
      profileImageUrl: 'https://example.com/img.png',
    };

    const result = await resolver.updateMyProfileImage(user, input);

    expect(profileService.updateMyProfileImage).toHaveBeenCalledWith(
      BigInt(3),
      input,
    );
    expect(result).toBe(mockMePayload);
  });

  it('deleteMyAccount는 accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    profileService.deleteMyAccount.mockResolvedValue(true);

    const user = { accountId: '4' };
    const result = await resolver.deleteMyAccount(user);

    expect(profileService.deleteMyAccount).toHaveBeenCalledWith(BigInt(4));
    expect(result).toBe(true);
  });

  it('completeOnboarding은 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('Nickname already exists.');
    profileService.completeOnboarding.mockRejectedValue(error);

    const user = { accountId: '1' };
    const input: CompleteOnboardingInput = { nickname: 'dup' };

    await expect(resolver.completeOnboarding(user, input)).rejects.toThrow(
      error,
    );
  });
});

// ---------------------------------------------------------------------------
// UserNotificationQueryResolver
// ---------------------------------------------------------------------------

describe('UserNotificationQueryResolver', () => {
  let resolver: UserNotificationQueryResolver;
  let notificationService: jest.Mocked<UserNotificationService>;

  beforeEach(async () => {
    notificationService = {
      viewerCounts: jest.fn(),
      myNotifications: jest.fn(),
    } as unknown as jest.Mocked<UserNotificationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserNotificationQueryResolver,
        { provide: UserNotificationService, useValue: notificationService },
      ],
    }).compile();

    resolver = module.get<UserNotificationQueryResolver>(
      UserNotificationQueryResolver,
    );
  });

  it('viewerCounts는 accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    notificationService.viewerCounts.mockResolvedValue(mockViewerCounts);

    const user = { accountId: '1' };
    const result = await resolver.viewerCounts(user);

    expect(notificationService.viewerCounts).toHaveBeenCalledWith(BigInt(1));
    expect(result).toBe(mockViewerCounts);
  });

  it('myNotifications는 accountId를 BigInt로 변환하고 input을 서비스에 전달해야 한다', async () => {
    notificationService.myNotifications.mockResolvedValue(
      mockNotificationConnection,
    );

    const user = { accountId: '2' };
    const input = { unreadOnly: true, offset: 0, limit: 10 };

    const result = await resolver.myNotifications(user, input);

    expect(notificationService.myNotifications).toHaveBeenCalledWith(
      BigInt(2),
      input,
    );
    expect(result).toBe(mockNotificationConnection);
  });

  it('myNotifications는 input 없이 호출할 수 있어야 한다', async () => {
    notificationService.myNotifications.mockResolvedValue(
      mockNotificationConnection,
    );

    const user = { accountId: '1' };
    const result = await resolver.myNotifications(user, undefined);

    expect(notificationService.myNotifications).toHaveBeenCalledWith(
      BigInt(1),
      undefined,
    );
    expect(result).toBe(mockNotificationConnection);
  });

  it('viewerCounts는 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('User not found');
    notificationService.viewerCounts.mockRejectedValue(error);

    const user = { accountId: '1' };
    await expect(resolver.viewerCounts(user)).rejects.toThrow(error);
  });
});

// ---------------------------------------------------------------------------
// UserNotificationMutationResolver
// ---------------------------------------------------------------------------

describe('UserNotificationMutationResolver', () => {
  let resolver: UserNotificationMutationResolver;
  let notificationService: jest.Mocked<UserNotificationService>;

  beforeEach(async () => {
    notificationService = {
      markNotificationRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
    } as unknown as jest.Mocked<UserNotificationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserNotificationMutationResolver,
        { provide: UserNotificationService, useValue: notificationService },
      ],
    }).compile();

    resolver = module.get<UserNotificationMutationResolver>(
      UserNotificationMutationResolver,
    );
  });

  it('markNotificationRead는 notificationId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    notificationService.markNotificationRead.mockResolvedValue(true);

    const user = { accountId: '1' };
    const result = await resolver.markNotificationRead(user, '5');

    expect(notificationService.markNotificationRead).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(5),
    );
    expect(result).toBe(true);
  });

  it('markAllNotificationsRead는 accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    notificationService.markAllNotificationsRead.mockResolvedValue(true);

    const user = { accountId: '1' };
    const result = await resolver.markAllNotificationsRead(user);

    expect(notificationService.markAllNotificationsRead).toHaveBeenCalledWith(
      BigInt(1),
    );
    expect(result).toBe(true);
  });

  it('markNotificationRead는 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('Notification not found.');
    notificationService.markNotificationRead.mockRejectedValue(error);

    const user = { accountId: '1' };
    await expect(resolver.markNotificationRead(user, '99')).rejects.toThrow(
      error,
    );
  });
});

// ---------------------------------------------------------------------------
// UserSearchQueryResolver
// ---------------------------------------------------------------------------

describe('UserSearchQueryResolver', () => {
  let resolver: UserSearchQueryResolver;
  let searchService: jest.Mocked<UserSearchService>;

  beforeEach(async () => {
    searchService = {
      mySearchHistories: jest.fn(),
    } as unknown as jest.Mocked<UserSearchService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSearchQueryResolver,
        { provide: UserSearchService, useValue: searchService },
      ],
    }).compile();

    resolver = module.get<UserSearchQueryResolver>(UserSearchQueryResolver);
  });

  it('mySearchHistories는 accountId를 BigInt로 변환하고 input을 서비스에 전달해야 한다', async () => {
    searchService.mySearchHistories.mockResolvedValue(
      mockSearchHistoryConnection,
    );

    const user = { accountId: '1' };
    const input = { offset: 0, limit: 10 };

    const result = await resolver.mySearchHistories(user, input);

    expect(searchService.mySearchHistories).toHaveBeenCalledWith(
      BigInt(1),
      input,
    );
    expect(result).toBe(mockSearchHistoryConnection);
  });

  it('mySearchHistories는 input 없이 호출할 수 있어야 한다', async () => {
    searchService.mySearchHistories.mockResolvedValue(
      mockSearchHistoryConnection,
    );

    const user = { accountId: '1' };
    const result = await resolver.mySearchHistories(user, undefined);

    expect(searchService.mySearchHistories).toHaveBeenCalledWith(
      BigInt(1),
      undefined,
    );
    expect(result).toBe(mockSearchHistoryConnection);
  });

  it('mySearchHistories는 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('User not found');
    searchService.mySearchHistories.mockRejectedValue(error);

    const user = { accountId: '1' };
    await expect(resolver.mySearchHistories(user)).rejects.toThrow(error);
  });
});

// ---------------------------------------------------------------------------
// UserSearchMutationResolver
// ---------------------------------------------------------------------------

describe('UserSearchMutationResolver', () => {
  let resolver: UserSearchMutationResolver;
  let searchService: jest.Mocked<UserSearchService>;

  beforeEach(async () => {
    searchService = {
      deleteSearchHistory: jest.fn(),
      clearSearchHistories: jest.fn(),
    } as unknown as jest.Mocked<UserSearchService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSearchMutationResolver,
        { provide: UserSearchService, useValue: searchService },
      ],
    }).compile();

    resolver = module.get<UserSearchMutationResolver>(
      UserSearchMutationResolver,
    );
  });

  it('deleteSearchHistory는 id를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    searchService.deleteSearchHistory.mockResolvedValue(true);

    const user = { accountId: '1' };
    const result = await resolver.deleteSearchHistory(user, '7');

    expect(searchService.deleteSearchHistory).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(7),
    );
    expect(result).toBe(true);
  });

  it('clearSearchHistories는 accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    searchService.clearSearchHistories.mockResolvedValue(true);

    const user = { accountId: '2' };
    const result = await resolver.clearSearchHistories(user);

    expect(searchService.clearSearchHistories).toHaveBeenCalledWith(BigInt(2));
    expect(result).toBe(true);
  });

  it('deleteSearchHistory는 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('Search history not found.');
    searchService.deleteSearchHistory.mockRejectedValue(error);

    const user = { accountId: '1' };
    await expect(resolver.deleteSearchHistory(user, '99')).rejects.toThrow(
      error,
    );
  });
});

// ---------------------------------------------------------------------------
// UserEngagementMutationResolver
// ---------------------------------------------------------------------------

describe('UserEngagementMutationResolver', () => {
  let resolver: UserEngagementMutationResolver;
  let engagementService: jest.Mocked<UserEngagementService>;

  beforeEach(async () => {
    engagementService = {
      likeReview: jest.fn(),
    } as unknown as jest.Mocked<UserEngagementService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEngagementMutationResolver,
        { provide: UserEngagementService, useValue: engagementService },
      ],
    }).compile();

    resolver = module.get<UserEngagementMutationResolver>(
      UserEngagementMutationResolver,
    );
  });

  it('likeReview는 reviewId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    engagementService.likeReview.mockResolvedValue(true);

    const user = { accountId: '1' };
    const result = await resolver.likeReview(user, '42');

    expect(engagementService.likeReview).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(42),
    );
    expect(result).toBe(true);
  });

  it('likeReview는 서비스 에러를 그대로 전파해야 한다', async () => {
    const error = new Error('Review not found.');
    engagementService.likeReview.mockRejectedValue(error);

    const user = { accountId: '1' };
    await expect(resolver.likeReview(user, '99')).rejects.toThrow(error);
  });
});

// ---------------------------------------------------------------------------
// UserMypageQueryResolver
// ---------------------------------------------------------------------------

describe('UserMypageQueryResolver', () => {
  let resolver: UserMypageQueryResolver;
  let mypageService: jest.Mocked<UserMypageService>;

  beforeEach(async () => {
    mypageService = {
      getOverview: jest.fn(),
    } as unknown as jest.Mocked<UserMypageService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserMypageQueryResolver,
        { provide: UserMypageService, useValue: mypageService },
      ],
    }).compile();

    resolver = module.get<UserMypageQueryResolver>(UserMypageQueryResolver);
  });

  it('myPageOverview는 accountId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    const mockOverview = {
      counts: {
        customDraftCount: 0,
        couponCount: 0,
        wishlistCount: 0,
        myReviewCount: 0,
      },
      ongoingOrders: [],
      recentViewedProducts: [],
    };
    mypageService.getOverview.mockResolvedValue(mockOverview);

    const user = { accountId: '1' };
    const result = await resolver.myPageOverview(user);

    expect(mypageService.getOverview).toHaveBeenCalledWith(BigInt(1));
    expect(result).toBe(mockOverview);
  });
});

// ---------------------------------------------------------------------------
// UserOrderQueryResolver
// ---------------------------------------------------------------------------

describe('UserOrderQueryResolver', () => {
  let resolver: UserOrderQueryResolver;
  let orderService: jest.Mocked<UserOrderService>;

  beforeEach(async () => {
    orderService = {
      listMyOrders: jest.fn(),
      getMyOrder: jest.fn(),
    } as unknown as jest.Mocked<UserOrderService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserOrderQueryResolver,
        { provide: UserOrderService, useValue: orderService },
      ],
    }).compile();

    resolver = module.get<UserOrderQueryResolver>(UserOrderQueryResolver);
  });

  it('myOrders는 accountId와 input을 서비스에 전달해야 한다', async () => {
    const mockConnection = { items: [], totalCount: 0, hasMore: false };
    orderService.listMyOrders.mockResolvedValue(mockConnection);

    const user = { accountId: '1' };
    const input = { statuses: undefined, offset: 0, limit: 20 };
    const result = await resolver.myOrders(user, input);

    expect(orderService.listMyOrders).toHaveBeenCalledWith(BigInt(1), input);
    expect(result).toBe(mockConnection);
  });

  it('myOrder는 orderId를 BigInt로 변환하여 서비스에 전달해야 한다', async () => {
    const mockDetail = { orderId: '100' } as never;
    orderService.getMyOrder.mockResolvedValue(mockDetail);

    const user = { accountId: '1' };
    const result = await resolver.myOrder(user, '100');

    expect(orderService.getMyOrder).toHaveBeenCalledWith(
      BigInt(1),
      BigInt(100),
    );
    expect(result).toBe(mockDetail);
  });
});

// ---------------------------------------------------------------------------
// UserRecentViewQueryResolver / MutationResolver
// ---------------------------------------------------------------------------

describe('UserRecentViewQueryResolver', () => {
  let resolver: UserRecentViewQueryResolver;
  let recentViewService: jest.Mocked<UserRecentViewService>;

  beforeEach(async () => {
    recentViewService = {
      list: jest.fn(),
    } as unknown as jest.Mocked<UserRecentViewService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRecentViewQueryResolver,
        { provide: UserRecentViewService, useValue: recentViewService },
      ],
    }).compile();

    resolver = module.get<UserRecentViewQueryResolver>(
      UserRecentViewQueryResolver,
    );
  });

  it('myRecentViewedProducts는 서비스에 위임해야 한다', async () => {
    const mockResult = { items: [], totalCount: 0, hasMore: false };
    recentViewService.list.mockResolvedValue(mockResult);

    const user = { accountId: '1' };
    const result = await resolver.myRecentViewedProducts(user, {
      offset: 0,
      limit: 20,
    });

    expect(recentViewService.list).toHaveBeenCalledWith(BigInt(1), {
      offset: 0,
      limit: 20,
    });
    expect(result).toBe(mockResult);
  });
});

describe('UserRecentViewMutationResolver', () => {
  let resolver: UserRecentViewMutationResolver;
  let recentViewService: jest.Mocked<UserRecentViewService>;

  beforeEach(async () => {
    recentViewService = {
      record: jest.fn(),
      deleteOne: jest.fn(),
      clearAll: jest.fn(),
    } as unknown as jest.Mocked<UserRecentViewService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRecentViewMutationResolver,
        { provide: UserRecentViewService, useValue: recentViewService },
      ],
    }).compile();

    resolver = module.get<UserRecentViewMutationResolver>(
      UserRecentViewMutationResolver,
    );
  });

  it('recordProductView는 서비스에 위임해야 한다', async () => {
    recentViewService.record.mockResolvedValue(true);
    const result = await resolver.recordProductView({ accountId: '1' }, '200');
    expect(recentViewService.record).toHaveBeenCalledWith(BigInt(1), '200');
    expect(result).toBe(true);
  });

  it('deleteRecentViewedProduct는 서비스에 위임해야 한다', async () => {
    recentViewService.deleteOne.mockResolvedValue(true);
    const result = await resolver.deleteRecentViewedProduct(
      { accountId: '1' },
      '200',
    );
    expect(recentViewService.deleteOne).toHaveBeenCalledWith(BigInt(1), '200');
    expect(result).toBe(true);
  });

  it('clearRecentViewedProducts는 서비스에 위임해야 한다', async () => {
    recentViewService.clearAll.mockResolvedValue(true);
    const result = await resolver.clearRecentViewedProducts({ accountId: '1' });
    expect(recentViewService.clearAll).toHaveBeenCalledWith(BigInt(1));
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UserReviewQueryResolver / MutationResolver
// ---------------------------------------------------------------------------

describe('UserReviewQueryResolver', () => {
  let resolver: UserReviewQueryResolver;
  let reviewService: jest.Mocked<UserReviewService>;

  beforeEach(async () => {
    reviewService = {
      myReviews: jest.fn(),
      myReviewForOrderItem: jest.fn(),
    } as unknown as jest.Mocked<UserReviewService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserReviewQueryResolver,
        { provide: UserReviewService, useValue: reviewService },
      ],
    }).compile();

    resolver = module.get<UserReviewQueryResolver>(UserReviewQueryResolver);
  });

  it('myReviews는 서비스에 위임해야 한다', async () => {
    const mockResult = { items: [], totalCount: 0, hasMore: false };
    reviewService.myReviews.mockResolvedValue(mockResult);

    const result = await resolver.myReviews(
      { accountId: '1' },
      { offset: 0, limit: 20 },
    );

    expect(reviewService.myReviews).toHaveBeenCalledWith(BigInt(1), {
      offset: 0,
      limit: 20,
    });
    expect(result).toBe(mockResult);
  });

  it('myReviewForOrderItem은 서비스에 위임해야 한다', async () => {
    const mockResult = {
      review: null,
      canWrite: true,
      reasonIfCannotWrite: null,
    };
    reviewService.myReviewForOrderItem.mockResolvedValue(mockResult);

    const result = await resolver.myReviewForOrderItem(
      { accountId: '1' },
      '200',
    );

    expect(reviewService.myReviewForOrderItem).toHaveBeenCalledWith(
      BigInt(1),
      '200',
    );
    expect(result).toBe(mockResult);
  });
});

describe('UserReviewMutationResolver', () => {
  let resolver: UserReviewMutationResolver;
  let reviewService: jest.Mocked<UserReviewService>;

  beforeEach(async () => {
    reviewService = {
      writeReview: jest.fn(),
      deleteMyReview: jest.fn(),
      createReviewMediaUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<UserReviewService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserReviewMutationResolver,
        { provide: UserReviewService, useValue: reviewService },
      ],
    }).compile();

    resolver = module.get<UserReviewMutationResolver>(
      UserReviewMutationResolver,
    );
  });

  it('writeReview는 서비스에 위임해야 한다', async () => {
    const mockReview = { reviewId: '500' } as never;
    const input = {
      orderItemId: '200',
      rating: 4.5,
      content: '좋은 케이크입니다 정말 맛있어요!',
    };
    reviewService.writeReview.mockResolvedValue(mockReview);

    const result = await resolver.writeReview({ accountId: '1' }, input);

    expect(reviewService.writeReview).toHaveBeenCalledWith(BigInt(1), input);
    expect(result).toBe(mockReview);
  });

  it('deleteMyReview는 서비스에 위임해야 한다', async () => {
    reviewService.deleteMyReview.mockResolvedValue(true);

    const result = await resolver.deleteMyReview({ accountId: '1' }, '500');

    expect(reviewService.deleteMyReview).toHaveBeenCalledWith(BigInt(1), '500');
    expect(result).toBe(true);
  });

  it('createReviewMediaUploadUrl은 서비스에 위임해야 한다', async () => {
    const mockUrl = {
      uploadUrl: 'https://presigned.url',
      publicUrl: 'https://s3/img.jpg',
      key: 'k',
      expiresInSeconds: 600,
    };
    const input = {
      mediaType: 'IMAGE' as const,
      contentType: 'image/jpeg',
      contentLength: 1024,
    };
    reviewService.createReviewMediaUploadUrl.mockResolvedValue(mockUrl);

    const result = await resolver.createReviewMediaUploadUrl(
      { accountId: '1' },
      input,
    );

    expect(reviewService.createReviewMediaUploadUrl).toHaveBeenCalledWith(
      BigInt(1),
      input,
    );
    expect(result).toBe(mockUrl);
  });
});
