import type { SellerCreateBannerInput } from '@/features/seller/dto/inputs/seller-create-banner.input';
import type { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';
import type { SellerUpdateBannerInput } from '@/features/seller/dto/inputs/seller-update-banner.input';
import type {
  SellerBannerOutput,
  SellerCursorConnection,
} from '@/features/seller/types/seller-output.type';

export const SELLER_BANNER_SERVICE = Symbol('SELLER_BANNER_SERVICE');

/**
 * Seller 매장 배너 서비스 인터페이스.
 *
 * 단일 책임: 매장 배너 CRUD + linkType 정합성 가드 (B-1 정책).
 */
export interface ISellerBannerService {
  sellerBanners(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerBannerOutput>>;

  sellerCreateBanner(
    accountId: bigint,
    input: SellerCreateBannerInput,
  ): Promise<SellerBannerOutput>;

  sellerUpdateBanner(
    accountId: bigint,
    input: SellerUpdateBannerInput,
  ): Promise<SellerBannerOutput>;

  sellerDeleteBanner(accountId: bigint, bannerId: bigint): Promise<boolean>;
}
