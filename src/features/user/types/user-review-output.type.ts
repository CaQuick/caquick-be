import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { ReviewMedia } from '@/features/review';

export interface MyReview {
  reviewId: string;
  orderItemId: string;
  productId: string;
  productName: string;
  productImageUrl: string | null;
  storeName: string;
  rating: number;
  content: string | null;
  media: ReviewMedia[];
  createdAt: Date;
}

export type MyReviewConnection = OffsetConnection<MyReview>;

export interface MyReviewableOrderItem {
  orderItemId: string;
  productId: string;
  productName: string;
  productImageUrl: string | null;
  storeName: string;
  regionLabel: string | null;
  pickedUpAt: Date | null;
}

export type MyReviewableOrderItemConnection =
  OffsetConnection<MyReviewableOrderItem>;

export interface MyReviewOrNull {
  review: MyReview | null;
  canWrite: boolean;
  reasonIfCannotWrite: string | null;
}

export interface MyReviewComment {
  id: string;
  reviewId: string;
  content: string;
  createdAt: Date;
}
