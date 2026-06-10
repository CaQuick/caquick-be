import type { SellerDateCursorInput } from '@/features/seller/dto/inputs/seller-date-cursor.input';
import type { SellerUpdatePickupPolicyInput } from '@/features/seller/dto/inputs/seller-update-pickup-policy.input';
import type { SellerUpsertStoreDailyCapacityInput } from '@/features/seller/dto/inputs/seller-upsert-store-daily-capacity.input';
import type {
  SellerCursorConnection,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
} from '@/features/seller/types/seller-output.type';

export const SELLER_STORE_POLICY_SERVICE = Symbol(
  'SELLER_STORE_POLICY_SERVICE',
);

/**
 * Seller 매장 픽업 정책 / 일별 캐파 서비스 인터페이스.
 *
 * 단일 책임: 매장의 픽업 슬롯 정책(주문 가능 범위) + 일자별 캐파 설정.
 */
export interface ISellerStorePolicyService {
  sellerStoreDailyCapacities(
    accountId: bigint,
    input?: SellerDateCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreDailyCapacityOutput>>;

  sellerUpdatePickupPolicy(
    accountId: bigint,
    input: SellerUpdatePickupPolicyInput,
  ): Promise<SellerStoreOutput>;

  sellerUpsertStoreDailyCapacity(
    accountId: bigint,
    input: SellerUpsertStoreDailyCapacityInput,
  ): Promise<SellerStoreDailyCapacityOutput>;

  sellerDeleteStoreDailyCapacity(
    accountId: bigint,
    capacityId: bigint,
  ): Promise<boolean>;
}
