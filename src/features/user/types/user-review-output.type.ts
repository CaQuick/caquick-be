export interface MyReviewMedia {
  mediaType: 'IMAGE' | 'VIDEO';
  mediaUrl: string;
  thumbnailUrl: string | null;
  sortOrder: number;
}

export interface MyReview {
  reviewId: string;
  orderItemId: string;
  productId: string;
  productName: string;
  productImageUrl: string | null;
  storeName: string;
  rating: number;
  content: string | null;
  media: MyReviewMedia[];
  createdAt: Date;
}

export interface MyReviewConnection {
  items: MyReview[];
  totalCount: number;
  hasMore: boolean;
}

export interface MyReviewOrNull {
  review: MyReview | null;
  canWrite: boolean;
  reasonIfCannotWrite: string | null;
}

export interface ReviewMediaUploadUrl {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}
