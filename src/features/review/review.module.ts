import { Module } from '@nestjs/common';

import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { ReviewListingQueryResolver } from '@/features/review/resolvers/review-listing-query.resolver';
import { ReviewListingService } from '@/features/review/services/review-listing.service';

@Module({
  providers: [
    ReviewReadRepository,
    ReviewListingService,
    ReviewListingQueryResolver,
  ],
  // ReviewReadRepository는 리뷰 상세·댓글(product)과 홈 쇼케이스(product)가 집계·row 조회에 소비한다
  exports: [ReviewReadRepository],
})
export class ReviewModule {}
