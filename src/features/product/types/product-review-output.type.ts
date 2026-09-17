import type { CursorConnection } from '@/common/types/cursor-connection.type';
import type { ProductReview } from '@/features/review';

/**
 * 리뷰 상세·댓글 resolver 반환용 도메인 출력 타입.
 * SDL(product-reviews.graphql)의 타입과 필드 일치. 리뷰 카드(ProductReview)는 review feature 소유.
 */

export interface ReviewDetailProduct {
  productId: string;
  name: string;
  thumbnailUrl: string | null;
  storeName: string;
  regionLabel: string | null;
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
}

export interface ReviewDetail {
  review: ProductReview;
  product: ReviewDetailProduct;
}

export interface ReviewCommentItem {
  id: string;
  content: string;
  authorNickname: string | null;
  authorProfileImageUrl: string | null;
  isMine: boolean;
  createdAt: Date;
}

export type ReviewCommentConnection = CursorConnection<ReviewCommentItem>;
