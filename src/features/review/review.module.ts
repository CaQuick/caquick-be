import { Module } from '@nestjs/common';

import { ProductReviewRepository } from '@/features/review/repositories/product-review.repository';
import { RecentProductViewRepository } from '@/features/review/repositories/recent-product-view.repository';
import { ReviewEngagementRepository } from '@/features/review/repositories/review-engagement.repository';
import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { ReviewReportRepository } from '@/features/review/repositories/review-report.repository';
import { ReviewRepository } from '@/features/review/repositories/review.repository';
import { StoreWishlistRepository } from '@/features/review/repositories/store-wishlist.repository';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import { ReviewListingQueryResolver } from '@/features/review/resolvers/review-listing-query.resolver';
import { ReviewListingService } from '@/features/review/services/review-listing.service';

@Module({
  providers: [
    ReviewReadRepository,
    ReviewRepository,
    ReviewEngagementRepository,
    ReviewReportRepository,
    ProductReviewRepository,
    WishlistRepository,
    StoreWishlistRepository,
    RecentProductViewRepository,
    ReviewListingService,
    ReviewListingQueryResolver,
  ],
  // review 소유 모델의 write는 전부 이 feature의 repository를 거친다(소유 맵). 구매자·매장·상품 서비스가 배럴로 주입받는다.
  exports: [
    ReviewReadRepository,
    ReviewRepository,
    ReviewEngagementRepository,
    ReviewReportRepository,
    ProductReviewRepository,
    WishlistRepository,
    StoreWishlistRepository,
    RecentProductViewRepository,
  ],
})
export class ReviewModule {}
