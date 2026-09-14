// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ReviewModule } from '@/features/review/review.module';
export { ReviewListingRepository } from '@/features/review/repositories/review-listing.repository';
export {
  fetchReviewIdPage,
  type ReviewIdPage,
  type ReviewSort,
} from '@/features/review/services/review-id-page.helper';
export type {
  ReviewLikeRankRow,
  ReviewLikesScope,
  ReviewMediaRow,
  ReviewStat,
  ReviewStatKey,
} from '@/features/review/types/review-listing.type';
