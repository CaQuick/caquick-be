import type { CursorConnection } from '@/common/types/cursor-connection.type';

export interface ReviewMedia {
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
  media: ReviewMedia[];
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

export interface StoreReview {
  id: string;
  rating: number;
  content: string | null;
  media: ReviewMedia[];
  likeCount: number;
  isLiked: boolean;
  authorNickname: string | null;
  productName: string;
  createdAt: Date;
}

export type StoreReviewConnection = CursorConnection<StoreReview> & {
  photoTotalCount: number;
};
