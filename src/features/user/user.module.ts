import { Module } from '@nestjs/common';

import { OrderModule } from '@/features/order/order.module';
import { ProductModule } from '@/features/product/product.module';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserEngagementMutationResolver } from '@/features/user/resolvers/user-engagement-mutation.resolver';
import { UserMypageQueryResolver } from '@/features/user/resolvers/user-mypage-query.resolver';
import { UserNotificationMutationResolver } from '@/features/user/resolvers/user-notification-mutation.resolver';
import { UserNotificationQueryResolver } from '@/features/user/resolvers/user-notification-query.resolver';
import { UserOrderQueryResolver } from '@/features/user/resolvers/user-order-query.resolver';
import { UserProfileMutationResolver } from '@/features/user/resolvers/user-profile-mutation.resolver';
import { UserProfileQueryResolver } from '@/features/user/resolvers/user-profile-query.resolver';
import { UserRecentViewMutationResolver } from '@/features/user/resolvers/user-recent-view-mutation.resolver';
import { UserRecentViewQueryResolver } from '@/features/user/resolvers/user-recent-view-query.resolver';
import { UserSearchMutationResolver } from '@/features/user/resolvers/user-search-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/user/resolvers/user-search-query.resolver';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import { UserMypageService } from '@/features/user/services/user-mypage.service';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { UserOrderService } from '@/features/user/services/user-order.service';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import { UserSearchService } from '@/features/user/services/user-search.service';

/**
 * User 도메인 모듈
 */
@Module({
  imports: [OrderModule, ProductModule],
  providers: [
    UserProfileService,
    UserNotificationService,
    UserSearchService,
    UserEngagementService,
    UserMypageService,
    UserOrderService,
    UserRecentViewService,
    UserRepository,
    RecentProductViewRepository,
    UserProfileQueryResolver,
    UserNotificationQueryResolver,
    UserSearchQueryResolver,
    UserMypageQueryResolver,
    UserOrderQueryResolver,
    UserRecentViewQueryResolver,
    UserRecentViewMutationResolver,
    UserProfileMutationResolver,
    UserNotificationMutationResolver,
    UserSearchMutationResolver,
    UserEngagementMutationResolver,
  ],
})
export class UserModule {}
