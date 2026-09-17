import type { CursorConnection } from '@/common/types/cursor-connection.type';

/**
 * storeReviews resolver 반환용 도메인 출력 타입.
 * SDL(store-reviews.graphql)의 타입과 필드 일치.
 */

export interface StoreReviewMedia {
  mediaType: 'IMAGE' | 'VIDEO';
  mediaUrl: string;
  thumbnailUrl: string | null;
  sortOrder: number;
}

export interface StoreReview {
  id: string;
  rating: number;
  content: string | null;
  media: StoreReviewMedia[];
  likeCount: number;
  isLiked: boolean;
  authorNickname: string | null;
  productName: string;
  createdAt: Date;
}

export type StoreReviewConnection = CursorConnection<StoreReview> & {
  photoTotalCount: number;
};
