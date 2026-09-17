import { anonymizeReviewAuthor } from '@/common/utils/review-author';
import type {
  ReviewCommentRow,
  ReviewDetailProductRow,
} from '@/features/product/repositories/product-review.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type {
  ReviewCommentItem,
  ReviewDetailProduct,
} from '@/features/product/types/product-review-output.type';
import { buildRegionLabel } from '@/features/store';

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
  const author = anonymizeReviewAuthor(row.account.user_profile);
  return {
    id: row.id.toString(),
    content: row.content,
    authorNickname: author.nickname,
    authorProfileImageUrl: author.profileImageUrl,
    isMine: accountId !== undefined && row.account_id === accountId,
    createdAt: row.created_at,
  };
}
