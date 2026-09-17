import { anonymizeReviewAuthor } from '@/common/utils/review-author';
import type {
  ProductReviewRow,
  ReviewMediaRow,
  StoreReviewRow,
} from '@/features/review/repositories/review-read.repository';
import type {
  ProductReview,
  ReviewMedia,
  StoreReview,
} from '@/features/review/types/review-listing-output.type';

export interface ReviewStats {
  likeCount: number;
  isLiked: boolean;
}

export interface ProductReviewStats extends ReviewStats {
  commentCount: number;
}

export function toReviewMedia(row: ReviewMediaRow): ReviewMedia {
  return {
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    thumbnailUrl: row.thumbnail_url,
    sortOrder: row.sort_order,
  };
}

export function toProductReview(
  row: ProductReviewRow,
  stats: ProductReviewStats,
): ProductReview {
  const author = anonymizeReviewAuthor(row.account.user_profile);
  return {
    id: row.id.toString(),
    rating: Number(row.rating),
    content: row.content,
    media: row.media.map(toReviewMedia),
    likeCount: stats.likeCount,
    isLiked: stats.isLiked,
    commentCount: stats.commentCount,
    authorNickname: author.nickname,
    authorProfileImageUrl: author.profileImageUrl,
    customOptions: row.order_item.option_items.map((option) => ({
      groupName: option.group_name_snapshot,
      optionTitle: option.option_title_snapshot,
    })),
    createdAt: row.created_at,
  };
}

export function toStoreReview(
  row: StoreReviewRow,
  stats: ReviewStats,
): StoreReview {
  return {
    id: row.id.toString(),
    rating: Number(row.rating),
    content: row.content,
    media: row.media.map(toReviewMedia),
    likeCount: stats.likeCount,
    isLiked: stats.isLiked,
    authorNickname: anonymizeReviewAuthor(row.account.user_profile).nickname,
    productName: row.order_item.product_name_snapshot,
    createdAt: row.created_at,
  };
}
