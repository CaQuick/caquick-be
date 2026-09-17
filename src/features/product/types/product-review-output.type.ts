import type { CursorConnection } from '@/common/types/cursor-connection.type';
import type { ProductReview } from '@/features/review';

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
