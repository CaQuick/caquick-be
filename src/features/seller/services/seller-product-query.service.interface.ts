import type { SellerProductListInput } from '@/features/seller/dto/inputs/seller-product-list.input';
import type {
  SellerCursorConnection,
  SellerProductOutput,
} from '@/features/seller/types/seller-output.type';

export const SELLER_PRODUCT_QUERY_SERVICE = Symbol(
  'SELLER_PRODUCT_QUERY_SERVICE',
);

/**
 * Seller 상품 조회 서비스 인터페이스.
 *
 * 단일 책임: 조회 (list / detail). 변경은 별도 서비스가 담당.
 */
export interface ISellerProductQueryService {
  sellerProducts(
    accountId: bigint,
    input?: SellerProductListInput,
  ): Promise<SellerCursorConnection<SellerProductOutput>>;

  sellerProduct(
    accountId: bigint,
    productId: bigint,
  ): Promise<SellerProductOutput>;
}
