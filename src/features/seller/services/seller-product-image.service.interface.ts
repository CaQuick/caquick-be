import type { SellerAddProductImageInput } from '@/features/seller/dto/inputs/seller-add-product-image.input';
import type { SellerReorderProductImagesInput } from '@/features/seller/dto/inputs/seller-reorder-product-images.input';
import type { SellerProductImageOutput } from '@/features/seller/types/seller-output.type';

export const SELLER_PRODUCT_IMAGE_SERVICE = Symbol(
  'SELLER_PRODUCT_IMAGE_SERVICE',
);

/**
 * Seller 상품 이미지 서비스 인터페이스.
 *
 * 단일 책임: 이미지 추가 / 삭제 / 정렬 변경.
 */
export interface ISellerProductImageService {
  sellerAddProductImage(
    accountId: bigint,
    input: SellerAddProductImageInput,
  ): Promise<SellerProductImageOutput>;

  sellerDeleteProductImage(
    accountId: bigint,
    imageId: bigint,
  ): Promise<boolean>;

  sellerReorderProductImages(
    accountId: bigint,
    input: SellerReorderProductImagesInput,
  ): Promise<SellerProductImageOutput[]>;
}
