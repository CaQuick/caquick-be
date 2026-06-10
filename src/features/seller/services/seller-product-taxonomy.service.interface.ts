import type { SellerSetProductCategoriesInput } from '@/features/seller/dto/inputs/seller-set-product-categories.input';
import type { SellerSetProductTagsInput } from '@/features/seller/dto/inputs/seller-set-product-tags.input';
import type { SellerProductOutput } from '@/features/seller/types/seller-output.type';

export const SELLER_PRODUCT_TAXONOMY_SERVICE = Symbol(
  'SELLER_PRODUCT_TAXONOMY_SERVICE',
);

/**
 * Seller 상품 분류 (카테고리 / 태그) 서비스 인터페이스.
 *
 * 단일 책임: 상품의 categories / tags 일괄 교체.
 */
export interface ISellerProductTaxonomyService {
  sellerSetProductCategories(
    accountId: bigint,
    input: SellerSetProductCategoriesInput,
  ): Promise<SellerProductOutput>;

  sellerSetProductTags(
    accountId: bigint,
    input: SellerSetProductTagsInput,
  ): Promise<SellerProductOutput>;
}
