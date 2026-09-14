import { Module } from '@nestjs/common';

import { ReviewListingRepository } from '@/features/review/repositories/review-listing.repository';

/**
 * 리뷰 목록 조회의 공용 부분. 상품·매장·홈 쇼케이스가 공유한다.
 *
 * 화면별 고유 조회는 각 feature repository에 남고, 여기에는 좋아요 집계와
 * 좋아요순 키셋 페이지처럼 "어느 화면에서 보든 같은" 부분만 둔다.
 */
@Module({
  providers: [ReviewListingRepository],
  exports: [ReviewListingRepository],
})
export class ReviewModule {}
