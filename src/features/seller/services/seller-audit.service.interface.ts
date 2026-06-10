import type { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';
import type {
  SellerAuditLogOutput,
  SellerCursorConnection,
} from '@/features/seller/types/seller-output.type';

export const SELLER_AUDIT_SERVICE = Symbol('SELLER_AUDIT_SERVICE');

/**
 * Seller audit log 조회 서비스 인터페이스.
 *
 * 단일 책임: 매장 컨텍스트의 audit log 조회 (페이지네이션 + targetType 필터).
 */
export interface ISellerAuditService {
  sellerAuditLogs(
    accountId: bigint,
    input?: SellerAuditLogListInput,
  ): Promise<SellerCursorConnection<SellerAuditLogOutput>>;
}
