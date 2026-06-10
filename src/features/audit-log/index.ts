// cross-feature 공개 API. 구체 AuditLogRepository는 노출하지 않는다 —
// 소비처는 토큰(AUDIT_LOG_REPOSITORY) + 인터페이스(IAuditLogRepository)로만 주입.
export { AuditLogModule } from '@/features/audit-log/audit-log.module';
export {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log/repositories/audit-log.repository.interface';
