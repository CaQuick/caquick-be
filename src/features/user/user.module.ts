import { Module } from '@nestjs/common';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserEngagementMutationResolver } from '@/features/user/resolvers/user-engagement-mutation.resolver';
import { UserNotificationMutationResolver } from '@/features/user/resolvers/user-notification-mutation.resolver';
import { UserNotificationQueryResolver } from '@/features/user/resolvers/user-notification-query.resolver';
import { UserProfileMutationResolver } from '@/features/user/resolvers/user-profile-mutation.resolver';
import { UserProfileQueryResolver } from '@/features/user/resolvers/user-profile-query.resolver';
import { UserSearchMutationResolver } from '@/features/user/resolvers/user-search-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/user/resolvers/user-search-query.resolver';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { UserSearchService } from '@/features/user/services/user-search.service';
/**
 * User 도메인 모듈
 */
@Module({
  providers: [
    UserProfileService,
    UserNotificationService,
    UserSearchService,
    UserEngagementService,
    UserRepository,
    UserProfileQueryResolver,
    UserNotificationQueryResolver,
    UserSearchQueryResolver,
    UserProfileMutationResolver,
    UserNotificationMutationResolver,
    UserSearchMutationResolver,
    UserEngagementMutationResolver,
  ],
})
export class UserModule {}
