import type { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';
import type { SellerStoreOutput } from '@/features/seller/types/seller-output.type';

export const SELLER_STORE_PROFILE_SERVICE = Symbol(
  'SELLER_STORE_PROFILE_SERVICE',
);

/**
 * Seller 매장 프로필 서비스 인터페이스.
 *
 * 단일 책임: 매장 기본 정보 (이름/연락처/주소/지도/웹사이트/영업시간 텍스트) 조회·갱신.
 */
export interface ISellerStoreProfileService {
  sellerMyStore(accountId: bigint): Promise<SellerStoreOutput>;

  sellerUpdateStoreBasicInfo(
    accountId: bigint,
    input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput>;
}
