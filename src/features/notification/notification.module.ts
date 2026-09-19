import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { AdminNotificationMutationResolver } from '@/features/notification/resolvers/notification-admin-mutation.resolver';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';

/** 알림 소유 feature. 지금은 관리자 일괄 발송만 있고, 이벤트 소비자(outbox)는 08b에서 붙는다. */
@Module({
  imports: [AuthModule, AuditLogModule],
  providers: [
    NotificationAdminRepository,
    AdminNotificationService,
    AdminNotificationMutationResolver,
  ],
})
export class NotificationModule {}
