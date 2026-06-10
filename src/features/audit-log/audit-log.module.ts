import { Module } from '@nestjs/common';

import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log/repositories/audit-log.repository.interface';

/**
 * AuditLog 도메인 모듈
 *
 * - 모든 feature 가 감사 로그를 쓰는 단일 진입점
 * - interface + DI Token 패턴으로 제공
 */
@Module({
  providers: [
    {
      provide: AUDIT_LOG_REPOSITORY,
      useClass: AuditLogRepository,
    },
  ],
  exports: [AUDIT_LOG_REPOSITORY],
})
export class AuditLogModule {}
