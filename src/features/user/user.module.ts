import { Module } from '@nestjs/common';

import { UserRepository } from './repositories/user.repository';
import { UserEngagementMutationResolver } from './resolvers/user-engagement-mutation.resolver';
import { UserNotificationMutationResolver } from './resolvers/user-notification-mutation.resolver';
import { UserNotificationQueryResolver } from './resolvers/user-notification-query.resolver';
import { UserProfileMutationResolver } from './resolvers/user-profile-mutation.resolver';
import { UserProfileQueryResolver } from './resolvers/user-profile-query.resolver';
import { UserSearchMutationResolver } from './resolvers/user-search-mutation.resolver';
import { UserSearchQueryResolver } from './resolvers/user-search-query.resolver';
import { UserService } from './user.service';

/**
 * User 도메인 모듈
 */
@Module({
  providers: [
    UserService,
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
