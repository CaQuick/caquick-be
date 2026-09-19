import { Module } from '@nestjs/common';

import { AuthModule } from '@/features/auth';
import { UserMypageQueryResolver } from '@/features/mypage/resolvers/mypage-overview-query.resolver';
import { UserRecentViewMutationResolver } from '@/features/mypage/resolvers/mypage-recent-view-mutation.resolver';
import { UserRecentViewQueryResolver } from '@/features/mypage/resolvers/mypage-recent-view-query.resolver';
import { UserReviewMutationResolver } from '@/features/mypage/resolvers/mypage-review-mutation.resolver';
import { UserReviewQueryResolver } from '@/features/mypage/resolvers/mypage-review-query.resolver';
import { UserViewerCountsQueryResolver } from '@/features/mypage/resolvers/mypage-viewer-counts-query.resolver';
import { UserWishlistMutationResolver } from '@/features/mypage/resolvers/mypage-wishlist-mutation.resolver';
import { UserWishlistQueryResolver } from '@/features/mypage/resolvers/mypage-wishlist-query.resolver';
import { UserMypageService } from '@/features/mypage/services/mypage-overview.service';
import { UserRecentViewService } from '@/features/mypage/services/mypage-recent-view.service';
import { UserReviewService } from '@/features/mypage/services/mypage-review.service';
import { UserViewerCountsService } from '@/features/mypage/services/mypage-viewer-counts.service';
import { UserWishlistService } from '@/features/mypage/services/mypage-wishlist.service';
import { NotificationModule } from '@/features/notification';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { ReviewModule } from '@/features/review';

/**
 * 구매자 다도메인 집계 화면(P1-1). 소유 모델이 없고 auth·product·review·order·notification 배럴을 읽어 조립한다.
 * 찜·최근 본 상품·내 리뷰 화면이 여기 있는 이유: 리뷰 도메인 write는 review에 있지만 화면은 상품 카드(product)·리뷰 가능 주문(order)을
 * 함께 읽는데, product → review · order → product 의존이 있어 review에 두면 순환이다.
 */
@Module({
  imports: [
    AuthModule,
    ProductModule,
    ReviewModule,
    OrderModule,
    NotificationModule,
  ],
  providers: [
    UserMypageService,
    UserViewerCountsService,
    UserWishlistService,
    UserRecentViewService,
    UserReviewService,
    UserMypageQueryResolver,
    UserViewerCountsQueryResolver,
    UserWishlistQueryResolver,
    UserWishlistMutationResolver,
    UserRecentViewQueryResolver,
    UserRecentViewMutationResolver,
    UserReviewQueryResolver,
    UserReviewMutationResolver,
  ],
})
export class MypageModule {}
