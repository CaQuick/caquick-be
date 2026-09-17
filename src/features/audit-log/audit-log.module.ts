import { Module } from '@nestjs/common';

import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log/repositories/audit-log.repository.interface';

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
