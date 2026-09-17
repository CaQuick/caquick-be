import { Module } from '@nestjs/common';

import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { ReviewModule } from '@/features/review';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { ReviewReportRepository } from '@/features/user/repositories/review-report.repository';
import { ReviewRepository } from '@/features/user/repositories/review.repository';
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
import { UserReportMutationResolver } from '@/features/user/resolvers/user-report-mutation.resolver';
import { UserReviewMutationResolver } from '@/features/user/resolvers/user-review-mutation.resolver';
import { UserReviewQueryResolver } from '@/features/user/resolvers/user-review-query.resolver';
import { UserSearchMutationResolver } from '@/features/user/resolvers/user-search-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/user/resolvers/user-search-query.resolver';
import { UserWishlistMutationResolver } from '@/features/user/resolvers/user-wishlist-mutation.resolver';
import { UserWishlistQueryResolver } from '@/features/user/resolvers/user-wishlist-query.resolver';
import { UserEngagementService } from '@/features/user/services/user-engagement.service';
import { UserMypageService } from '@/features/user/services/user-mypage.service';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import { UserOrderService } from '@/features/user/services/user-order.service';
import { UserProfileService } from '@/features/user/services/user-profile.service';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import { UserReportService } from '@/features/user/services/user-report.service';
import { UserReviewService } from '@/features/user/services/user-review.service';
import { UserSearchService } from '@/features/user/services/user-search.service';
import { UserWishlistService } from '@/features/user/services/user-wishlist.service';

@Module({
  imports: [OrderModule, ProductModule, ReviewModule],
  providers: [
    UserProfileService,
    UserNotificationService,
    UserSearchService,
    UserEngagementService,
    UserReportService,
    ReviewReportRepository,
    UserMypageService,
    UserOrderService,
    UserRecentViewService,
    UserReviewService,
    UserWishlistService,
    UserRepository,
    RecentProductViewRepository,
    ReviewRepository,
    UserProfileQueryResolver,
    UserNotificationQueryResolver,
    UserSearchQueryResolver,
    UserMypageQueryResolver,
    UserOrderQueryResolver,
    UserRecentViewQueryResolver,
    UserRecentViewMutationResolver,
    UserReviewQueryResolver,
    UserReviewMutationResolver,
    UserProfileMutationResolver,
    UserNotificationMutationResolver,
    UserSearchMutationResolver,
    UserEngagementMutationResolver,
    UserReportMutationResolver,
    UserWishlistQueryResolver,
    UserWishlistMutationResolver,
  ],
})
export class UserModule {}
