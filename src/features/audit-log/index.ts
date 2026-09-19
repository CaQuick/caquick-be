// cross-feature 공개 API. 구체 AuditLogRepository는 노출하지 않는다 —
// 소비처는 토큰(AUDIT_LOG_REPOSITORY) + 인터페이스(IAuditLogRepository)로만 주입.
export { AuditLogModule } from '@/features/audit-log/audit-log.module';
export {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log/repositories/audit-log.repository.interface';
// 판매자 화면(내 매장 감사 로그, store feature)에 노출하는 대상 종류.
export {
  SELLER_AUDIT_TARGET_TYPES,
  type SellerAuditTargetType,
} from '@/features/audit-log/constants/audit-log.constants';
