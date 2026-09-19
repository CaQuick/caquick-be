import { Module } from '@nestjs/common';

import { AuthModule } from '@/features/auth';
import { NotificationModule } from '@/features/notification';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { ReviewModule } from '@/features/review';
import { UserMypageQueryResolver } from '@/features/user/resolvers/user-mypage-query.resolver';
import { UserOrderQueryResolver } from '@/features/user/resolvers/user-order-query.resolver';
import { UserRecentViewMutationResolver } from '@/features/user/resolvers/user-recent-view-mutation.resolver';
import { UserRecentViewQueryResolver } from '@/features/user/resolvers/user-recent-view-query.resolver';
import { UserReviewMutationResolver } from '@/features/user/resolvers/user-review-mutation.resolver';
import { UserReviewQueryResolver } from '@/features/user/resolvers/user-review-query.resolver';
import { UserViewerCountsQueryResolver } from '@/features/user/resolvers/user-viewer-counts-query.resolver';
import { UserWishlistMutationResolver } from '@/features/user/resolvers/user-wishlist-mutation.resolver';
import { UserWishlistQueryResolver } from '@/features/user/resolvers/user-wishlist-query.resolver';
import { UserMypageService } from '@/features/user/services/user-mypage.service';
import { UserOrderService } from '@/features/user/services/user-order.service';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import { UserReviewService } from '@/features/user/services/user-review.service';
import { UserViewerCountsService } from '@/features/user/services/user-viewer-counts.service';
import { UserWishlistService } from '@/features/user/services/user-wishlist.service';

@Module({
  imports: [
    AuthModule,
    OrderModule,
    ProductModule,
    ReviewModule,
    NotificationModule,
  ],
  providers: [
    UserMypageService,
    UserOrderService,
    UserRecentViewService,
    UserReviewService,
    UserWishlistService,
    UserMypageQueryResolver,
    UserOrderQueryResolver,
    UserRecentViewQueryResolver,
    UserRecentViewMutationResolver,
    UserReviewQueryResolver,
    UserReviewMutationResolver,
    UserWishlistQueryResolver,
    UserWishlistMutationResolver,
    // 다도메인 집계(viewerCounts) — 05c에서 mypage feature로
    UserViewerCountsService,
    UserViewerCountsQueryResolver,
  ],
})
export class UserModule {}
