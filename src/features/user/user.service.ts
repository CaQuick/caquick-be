import { Injectable } from '@nestjs/common';

import { UserEngagementService } from './services/user-engagement.service';
import { UserNotificationService } from './services/user-notification.service';
import { UserProfileService } from './services/user-profile.service';
import { UserSearchService } from './services/user-search.service';

@Injectable()
export class UserService {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly userNotificationService: UserNotificationService,
    private readonly userSearchService: UserSearchService,
    private readonly userEngagementService: UserEngagementService,
  ) {}

  me(
    ...args: Parameters<UserProfileService['me']>
  ): ReturnType<UserProfileService['me']> {
    return this.userProfileService.me(...args);
  }

  completeOnboarding(
    ...args: Parameters<UserProfileService['completeOnboarding']>
  ): ReturnType<UserProfileService['completeOnboarding']> {
    return this.userProfileService.completeOnboarding(...args);
  }

  updateMyProfile(
    ...args: Parameters<UserProfileService['updateMyProfile']>
  ): ReturnType<UserProfileService['updateMyProfile']> {
    return this.userProfileService.updateMyProfile(...args);
  }

  updateMyProfileImage(
    ...args: Parameters<UserProfileService['updateMyProfileImage']>
  ): ReturnType<UserProfileService['updateMyProfileImage']> {
    return this.userProfileService.updateMyProfileImage(...args);
  }

  deleteMyAccount(
    ...args: Parameters<UserProfileService['deleteMyAccount']>
  ): ReturnType<UserProfileService['deleteMyAccount']> {
    return this.userProfileService.deleteMyAccount(...args);
  }

  viewerCounts(
    ...args: Parameters<UserNotificationService['viewerCounts']>
  ): ReturnType<UserNotificationService['viewerCounts']> {
    return this.userNotificationService.viewerCounts(...args);
  }

  myNotifications(
    ...args: Parameters<UserNotificationService['myNotifications']>
  ): ReturnType<UserNotificationService['myNotifications']> {
    return this.userNotificationService.myNotifications(...args);
  }

  markNotificationRead(
    ...args: Parameters<UserNotificationService['markNotificationRead']>
  ): ReturnType<UserNotificationService['markNotificationRead']> {
    return this.userNotificationService.markNotificationRead(...args);
  }

  markAllNotificationsRead(
    ...args: Parameters<UserNotificationService['markAllNotificationsRead']>
  ): ReturnType<UserNotificationService['markAllNotificationsRead']> {
    return this.userNotificationService.markAllNotificationsRead(...args);
  }

  mySearchHistories(
    ...args: Parameters<UserSearchService['mySearchHistories']>
  ): ReturnType<UserSearchService['mySearchHistories']> {
    return this.userSearchService.mySearchHistories(...args);
  }

  deleteSearchHistory(
    ...args: Parameters<UserSearchService['deleteSearchHistory']>
  ): ReturnType<UserSearchService['deleteSearchHistory']> {
    return this.userSearchService.deleteSearchHistory(...args);
  }

  clearSearchHistories(
    ...args: Parameters<UserSearchService['clearSearchHistories']>
  ): ReturnType<UserSearchService['clearSearchHistories']> {
    return this.userSearchService.clearSearchHistories(...args);
  }

  likeReview(
    ...args: Parameters<UserEngagementService['likeReview']>
  ): ReturnType<UserEngagementService['likeReview']> {
    return this.userEngagementService.likeReview(...args);
  }
}
