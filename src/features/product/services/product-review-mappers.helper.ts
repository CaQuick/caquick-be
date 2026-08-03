import type {
  ProductReviewRow,
  ReviewAuthorRow,
  ReviewCommentRow,
  ReviewDetailProductRow,
} from '@/features/product/repositories/product-review.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type {
  ProductReview,
  ReviewCommentItem,
  ReviewDetailProduct,
} from '@/features/product/types/product-review-output.type';

/** 리뷰별 집계값(좋아요/댓글/isLiked) 매퍼 입력. */
export interface ProductReviewStats {
  likeCount: number;
  isLiked: boolean;
  commentCount: number;
}

/** 탈퇴(soft-delete) 작성자는 닉네임/프로필을 익명화한다. */
function toAuthor(account: ReviewAuthorRow): {
  nickname: string | null;
  profileImageUrl: string | null;
} {
  const profile = account.user_profile;
  if (!profile || profile.deleted_at !== null) {
    return { nickname: null, profileImageUrl: null };
  }
  return {
    nickname: profile.nickname,
    profileImageUrl: profile.profile_image_url,
  };
}

export function toProductReview(
  row: ProductReviewRow,
  stats: ProductReviewStats,
): ProductReview {
  const author = toAuthor(row.account);
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

/** 매장 위치 표기. address_city/neighborhood 우선, 없으면 region명. */
function buildRegionLabel(store: ReviewDetailProductRow['store']): string | null {
  const parts = [store.address_city, store.address_neighborhood].filter(
    (part): part is string => Boolean(part),
  );
  if (parts.length > 0) return parts.join(' ');
  return store.region?.name ?? null;
}

export function toReviewDetailProduct(
  row: ReviewDetailProductRow,
): ReviewDetailProduct {
  return {
    productId: row.id.toString(),
    name: row.name,
    thumbnailUrl: row.images[0]?.image_url ?? null,
    storeName: row.store.store_name,
    regionLabel: buildRegionLabel(row.store),
    regularPrice: row.regular_price,
    salePrice: row.sale_price,
    discountRate: calcDiscountRate(row.regular_price, row.sale_price),
  };
}

export function toReviewCommentItem(
  row: ReviewCommentRow,
  accountId: bigint | undefined,
): ReviewCommentItem {
  const author = toAuthor(row.account);
  return {
    id: row.id.toString(),
    content: row.content,
    authorNickname: author.nickname,
    authorProfileImageUrl: author.profileImageUrl,
    isMine: accountId !== undefined && row.account_id === accountId,
    createdAt: row.created_at,
  };
}
