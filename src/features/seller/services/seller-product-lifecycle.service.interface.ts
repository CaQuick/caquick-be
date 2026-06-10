import type { SellerCreateProductInput } from '@/features/seller/dto/inputs/seller-create-product.input';
import type { SellerSetProductActiveInput } from '@/features/seller/dto/inputs/seller-set-product-active.input';
import type { SellerUpdateProductInput } from '@/features/seller/dto/inputs/seller-update-product.input';
import type { SellerProductOutput } from '@/features/seller/types/seller-output.type';

export const SELLER_PRODUCT_LIFECYCLE_SERVICE = Symbol(
  'SELLER_PRODUCT_LIFECYCLE_SERVICE',
);

/**
 * Seller 상품 라이프사이클 서비스 인터페이스.
 *
 * 단일 책임: 상품의 생성 / 수정 / 삭제 / 활성 토글.
 * 이미지·카테고리·태그 변경은 별도 서비스가 담당.
 */
export interface ISellerProductLifecycleService {
  sellerCreateProduct(
    accountId: bigint,
    input: SellerCreateProductInput,
  ): Promise<SellerProductOutput>;

  sellerUpdateProduct(
    accountId: bigint,
    input: SellerUpdateProductInput,
  ): Promise<SellerProductOutput>;

  sellerDeleteProduct(accountId: bigint, productId: bigint): Promise<boolean>;

  sellerSetProductActive(
    accountId: bigint,
    input: SellerSetProductActiveInput,
  ): Promise<SellerProductOutput>;
}
