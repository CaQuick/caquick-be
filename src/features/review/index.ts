// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ReviewModule } from '@/features/review/review.module';
// 공개 리뷰 읽기(집계·row 조회·쇼케이스). 리뷰 상세·댓글(product)과 홈 쇼케이스(product)가 소비한다.
export {
  ReviewReadRepository,
  type ProductReviewRow,
} from '@/features/review/repositories/review-read.repository';
// 리뷰 카드·미디어 매핑. 리뷰 상세(product)와 내 리뷰(user)가 같은 1벌을 쓴다.
export {
  toProductReview,
  toReviewMedia,
} from '@/features/review/services/review-listing-mappers.helper';
export type {
  ProductReview,
  ReviewMedia,
} from '@/features/review/types/review-listing-output.type';
