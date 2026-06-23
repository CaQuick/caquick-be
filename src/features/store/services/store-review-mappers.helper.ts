import type { StoreReviewRow } from '@/features/store/repositories/store-review.repository';
import type { StoreReview } from '@/features/store/types/store-review-output.type';

export function toStoreReview(
  row: StoreReviewRow,
  likeCount: number,
  isLiked: boolean,
): StoreReview {
  return {
    id: row.id.toString(),
    rating: Number(row.rating),
    content: row.content,
    media: row.media.map((m) => ({
      mediaType: m.media_type,
      mediaUrl: m.media_url,
      thumbnailUrl: m.thumbnail_url,
      sortOrder: m.sort_order,
    })),
    likeCount,
    isLiked,
    authorNickname: row.account.user_profile?.nickname ?? null,
    productName: row.order_item.product_name_snapshot,
    createdAt: row.created_at,
  };
}
