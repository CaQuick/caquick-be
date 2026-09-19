import { Module } from '@nestjs/common';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminAuditQueryResolver } from '@/features/admin/resolvers/admin-audit-query.resolver';
import { AdminDashboardQueryResolver } from '@/features/admin/resolvers/admin-dashboard-query.resolver';
import { AdminModerationMutationResolver } from '@/features/admin/resolvers/admin-moderation-mutation.resolver';
import { AdminModerationQueryResolver } from '@/features/admin/resolvers/admin-moderation-query.resolver';
import { AdminNotificationMutationResolver } from '@/features/admin/resolvers/admin-notification-mutation.resolver';
import { AdminOrderMutationResolver } from '@/features/admin/resolvers/admin-order-mutation.resolver';
import { AdminOrderQueryResolver } from '@/features/admin/resolvers/admin-order-query.resolver';
import { AdminAuditService } from '@/features/admin/services/admin-audit.service';
import { AdminDashboardService } from '@/features/admin/services/admin-dashboard.service';
import { AdminModerationService } from '@/features/admin/services/admin-moderation.service';
import { AdminNotificationService } from '@/features/admin/services/admin-notification.service';
import { AdminOrderService } from '@/features/admin/services/admin-order.service';
import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { OrderModule } from '@/features/order';
import { SearchModule } from '@/features/search';

/** cross-feature로 쓰이지 않아 배럴이 없다. DI는 구체 클래스 주입(2번째 구현 예정 없음). */
@Module({
  imports: [AuditLogModule, AuthModule, OrderModule, SearchModule],
  providers: [
    AdminRepository,
    AdminModerationService,
    AdminOrderService,
    AdminNotificationService,
    AdminAuditService,
    AdminDashboardService,
    AdminModerationQueryResolver,
    AdminModerationMutationResolver,
    AdminOrderQueryResolver,
    AdminOrderMutationResolver,
    AdminNotificationMutationResolver,
    AdminAuditQueryResolver,
    AdminDashboardQueryResolver,
  ],
})
export class AdminModule {}
