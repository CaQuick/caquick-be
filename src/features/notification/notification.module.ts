import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { AdminNotificationMutationResolver } from '@/features/notification/resolvers/notification-admin-mutation.resolver';
import { UserNotificationMutationResolver } from '@/features/notification/resolvers/notification-my-mutation.resolver';
import { UserNotificationQueryResolver } from '@/features/notification/resolvers/notification-my-query.resolver';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';
import { UserNotificationService } from '@/features/notification/services/notification-my.service';

/** 알림 소유 feature: 구매자 알림센터(목록·읽음)와 관리자 일괄 발송. 이벤트 소비자(outbox)는 08b에서 붙는다. */
@Module({
  imports: [AuthModule, AuditLogModule],
  providers: [
    NotificationAdminRepository,
    AdminNotificationService,
    AdminNotificationMutationResolver,
    NotificationRepository,
    UserNotificationService,
    UserNotificationQueryResolver,
    UserNotificationMutationResolver,
  ],
  // 미읽 수는 뷰어 카운트(user → 05c mypage)가 배럴로 읽는다
  exports: [NotificationRepository],
})
export class NotificationModule {}
