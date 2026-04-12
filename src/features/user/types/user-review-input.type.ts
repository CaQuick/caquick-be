export interface WriteReviewInput {
  orderItemId: string;
  rating: number;
  content: string;
  media?: WriteReviewMediaInput[];
}

export interface WriteReviewMediaInput {
  mediaType: 'IMAGE' | 'VIDEO';
  mediaUrl: string;
  thumbnailUrl?: string;
  sortOrder: number;
}

export interface MyReviewsInput {
  offset?: number;
  limit?: number;
}

export interface CreateReviewMediaUploadUrlInput {
  mediaType: 'IMAGE' | 'VIDEO';
  contentType: string;
  contentLength: number;
}
