import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { ProductReviewRepository } from '@/features/review/repositories/product-review.repository';
import { RecentProductViewRepository } from '@/features/review/repositories/recent-product-view.repository';
import { ReviewAdminRepository } from '@/features/review/repositories/review-admin.repository';
import { ReviewEngagementRepository } from '@/features/review/repositories/review-engagement.repository';
import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { ReviewReportRepository } from '@/features/review/repositories/review-report.repository';
import { ReviewRepository } from '@/features/review/repositories/review.repository';
import { StoreWishlistRepository } from '@/features/review/repositories/store-wishlist.repository';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import { AdminModerationMutationResolver } from '@/features/review/resolvers/review-admin-mutation.resolver';
import { AdminModerationQueryResolver } from '@/features/review/resolvers/review-admin-query.resolver';
import { ReviewListingQueryResolver } from '@/features/review/resolvers/review-listing-query.resolver';
import { AdminModerationService } from '@/features/review/services/review-admin.service';
import { ReviewListingService } from '@/features/review/services/review-listing.service';

@Module({
  // 관리자 모더레이션: 관리자 컨텍스트(AuthModule)·감사 기록(AuditLogModule)
  imports: [AuthModule, AuditLogModule],
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
    // 관리자 리뷰 모더레이션(신고 처리·강제 삭제·조회) — 리뷰 도메인이 소유한다
    ReviewAdminRepository,
    AdminModerationService,
    AdminModerationQueryResolver,
    AdminModerationMutationResolver,
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
