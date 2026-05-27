import type { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';
import type { SellerUpsertStoreBusinessHourInput } from '@/features/seller/dto/inputs/seller-upsert-store-business-hour.input';
import type { SellerUpsertStoreSpecialClosureInput } from '@/features/seller/dto/inputs/seller-upsert-store-special-closure.input';
import type {
  SellerCursorConnection,
  SellerStoreBusinessHourOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';

export const SELLER_STORE_HOURS_SERVICE = Symbol('SELLER_STORE_HOURS_SERVICE');

/**
 * Seller 매장 영업시간 / 특별 휴무 서비스 인터페이스.
 *
 * 단일 책임: 매장의 영업시간(요일 단위) + 특정 일자 휴무(special closure) 관리.
 */
export interface ISellerStoreHoursService {
  sellerStoreBusinessHours(
    accountId: bigint,
  ): Promise<SellerStoreBusinessHourOutput[]>;

  sellerStoreSpecialClosures(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreSpecialClosureOutput>>;

  sellerUpsertStoreBusinessHour(
    accountId: bigint,
    input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput>;

  sellerUpsertStoreSpecialClosure(
    accountId: bigint,
    input: SellerUpsertStoreSpecialClosureInput,
  ): Promise<SellerStoreSpecialClosureOutput>;

  sellerDeleteStoreSpecialClosure(
    accountId: bigint,
    closureId: bigint,
  ): Promise<boolean>;
}
