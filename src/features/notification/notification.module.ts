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
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { OutboxModule } from '@/features/outbox';

/** 알림 소유 feature: 구매자 알림센터(목록·읽음)·관리자 일괄 발송 요청·outbox 소비자(알림 생성의 단일 진입점). */
@Module({
  imports: [AuthModule, AuditLogModule, OutboxModule],
  providers: [
    NotificationAdminRepository,
    AdminNotificationService,
    AdminNotificationMutationResolver,
    NotificationRepository,
    NotificationOutboxConsumer,
    UserNotificationService,
    UserNotificationQueryResolver,
    UserNotificationMutationResolver,
  ],
  // 미읽 수는 뷰어 카운트(user → 05c mypage)가 배럴로 읽는다
  exports: [NotificationRepository],
})
export class NotificationModule {}
