import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { AdminNotificationMutationResolver } from '@/features/notification/resolvers/notification-admin-mutation.resolver';
import { AdminNotificationQueryResolver } from '@/features/notification/resolvers/notification-admin-query.resolver';
import { UserNotificationMutationResolver } from '@/features/notification/resolvers/notification-my-mutation.resolver';
import { UserNotificationQueryResolver } from '@/features/notification/resolvers/notification-my-query.resolver';
import { SellerPushDeviceMutationResolver } from '@/features/notification/resolvers/notification-seller-push-mutation.resolver';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';
import { UserNotificationService } from '@/features/notification/services/notification-my.service';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { SellerPushDeviceService } from '@/features/notification/services/seller-push-device.service';
import { OutboxModule } from '@/features/outbox';
import { StoreModule } from '@/features/store';

/** 알림 소유 feature: 구매자 알림센터(목록·읽음)·관리자 일괄 발송 요청과 이력·outbox 소비자(알림 생성의 단일 진입점)·판매자 푸시 디바이스. */
@Module({
  // StoreModule은 판매자 컨텍스트(SellerBaseService → StoreSellerRepository)용
  imports: [AuthModule, AuditLogModule, OutboxModule, StoreModule],
  providers: [
    NotificationAdminRepository,
    AdminNotificationService,
    AdminNotificationMutationResolver,
    AdminNotificationQueryResolver,
    NotificationRepository,
    NotificationOutboxConsumer,
    UserNotificationService,
    UserNotificationQueryResolver,
    UserNotificationMutationResolver,
    SellerPushDeviceRepository,
    SellerPushDeviceService,
    SellerPushDeviceMutationResolver,
  ],
  // 미읽 수는 뷰어 카운트(user → 05c mypage)가 배럴로 읽는다
  exports: [NotificationRepository],
})
export class NotificationModule {}
