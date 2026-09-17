import type { CursorConnection } from '@/common/types/cursor-connection.type';

/**
 * product-reviews resolver 반환용 도메인 출력 타입.
 * SDL(product-reviews.graphql)의 타입과 필드 일치.
 */

export interface ProductReviewMedia {
  mediaType: 'IMAGE' | 'VIDEO';
  mediaUrl: string;
  thumbnailUrl: string | null;
  sortOrder: number;
}

export interface ReviewCustomOption {
  groupName: string;
  optionTitle: string;
}

export interface ProductReview {
  id: string;
  rating: number;
  content: string | null;
  media: ProductReviewMedia[];
  likeCount: number;
  isLiked: boolean;
  commentCount: number;
  authorNickname: string | null;
  authorProfileImageUrl: string | null;
  customOptions: ReviewCustomOption[];
  createdAt: Date;
}

export type ProductReviewConnection = CursorConnection<ProductReview> & {
  photoTotalCount: number;
};

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
