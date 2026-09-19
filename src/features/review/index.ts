// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ReviewModule } from '@/features/review/review.module';
// review 소유 모델 write·구매자/매장/상품 화면용 read. 이 feature 밖에서는 이 배럴로만 주입받는다.
export { ReviewRepository } from '@/features/review/repositories/review.repository';
export { ReviewEngagementRepository } from '@/features/review/repositories/review-engagement.repository';
export {
  ReviewReportRepository,
  type ReportTarget,
} from '@/features/review/repositories/review-report.repository';
export {
  ProductReviewRepository,
  type ReviewCommentRow,
  type ReviewDetailProductRow,
} from '@/features/review/repositories/product-review.repository';
export { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
export { StoreWishlistRepository } from '@/features/review/repositories/store-wishlist.repository';
export { RecentProductViewRepository } from '@/features/review/repositories/recent-product-view.repository';
// review 테이블 잠금·신고 종결 1벌 — 관리자 모더레이션(admin)이 자기 tx를 넘겨 쓴다.
export {
  lockActiveReviewRow,
  lockParentReviewOfComment,
  resolvePendingReports,
} from '@/features/review/repositories/review-lock.helper';
// 공개 리뷰 읽기(집계·row 조회·쇼케이스). 리뷰 상세·댓글(product)과 홈 쇼케이스(product)가 소비한다.
export {
  ReviewReadRepository,
  type ReviewStat,
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
