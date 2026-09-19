import { Module } from '@nestjs/common';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminAuditQueryResolver } from '@/features/admin/resolvers/admin-audit-query.resolver';
import { AdminContentMutationResolver } from '@/features/admin/resolvers/admin-content-mutation.resolver';
import { AdminContentQueryResolver } from '@/features/admin/resolvers/admin-content-query.resolver';
import { AdminDashboardQueryResolver } from '@/features/admin/resolvers/admin-dashboard-query.resolver';
import { AdminModerationMutationResolver } from '@/features/admin/resolvers/admin-moderation-mutation.resolver';
import { AdminModerationQueryResolver } from '@/features/admin/resolvers/admin-moderation-query.resolver';
import { AdminNotificationMutationResolver } from '@/features/admin/resolvers/admin-notification-mutation.resolver';
import { AdminOrderMutationResolver } from '@/features/admin/resolvers/admin-order-mutation.resolver';
import { AdminOrderQueryResolver } from '@/features/admin/resolvers/admin-order-query.resolver';
import { AdminProductMutationResolver } from '@/features/admin/resolvers/admin-product-mutation.resolver';
import { AdminProductQueryResolver } from '@/features/admin/resolvers/admin-product-query.resolver';
import { AdminRegionMutationResolver } from '@/features/admin/resolvers/admin-region-mutation.resolver';
import { AdminRegionQueryResolver } from '@/features/admin/resolvers/admin-region-query.resolver';
import { AdminStoreMutationResolver } from '@/features/admin/resolvers/admin-store-mutation.resolver';
import { AdminStoreQueryResolver } from '@/features/admin/resolvers/admin-store-query.resolver';
import { AdminTaxonomyMutationResolver } from '@/features/admin/resolvers/admin-taxonomy-mutation.resolver';
import { AdminTaxonomyQueryResolver } from '@/features/admin/resolvers/admin-taxonomy-query.resolver';
import { AdminUploadMutationResolver } from '@/features/admin/resolvers/admin-upload-mutation.resolver';
import { AdminAuditService } from '@/features/admin/services/admin-audit.service';
import { AdminBannerService } from '@/features/admin/services/admin-banner.service';
import { AdminDashboardService } from '@/features/admin/services/admin-dashboard.service';
import { AdminModerationService } from '@/features/admin/services/admin-moderation.service';
import { AdminNotificationService } from '@/features/admin/services/admin-notification.service';
import { AdminOrderService } from '@/features/admin/services/admin-order.service';
import { AdminProductService } from '@/features/admin/services/admin-product.service';
import { AdminRegionService } from '@/features/admin/services/admin-region.service';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import { AdminTaxonomyService } from '@/features/admin/services/admin-taxonomy.service';
import { AdminUploadService } from '@/features/admin/services/admin-upload.service';
import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { OrderModule } from '@/features/order';
import { SearchModule } from '@/features/search';

/** cross-feature로 쓰이지 않아 배럴이 없다. DI는 구체 클래스 주입(2번째 구현 예정 없음). */
@Module({
  imports: [AuditLogModule, AuthModule, OrderModule, SearchModule],
  providers: [
    AdminRepository,
    AdminBannerService,
    AdminStoreService,
    AdminProductService,
    AdminTaxonomyService,
    AdminModerationService,
    AdminOrderService,
    AdminNotificationService,
    AdminRegionService,
    AdminAuditService,
    AdminDashboardService,
    AdminUploadService,
    AdminContentQueryResolver,
    AdminContentMutationResolver,
    AdminStoreQueryResolver,
    AdminStoreMutationResolver,
    AdminProductQueryResolver,
    AdminProductMutationResolver,
    AdminTaxonomyQueryResolver,
    AdminTaxonomyMutationResolver,
    AdminModerationQueryResolver,
    AdminModerationMutationResolver,
    AdminOrderQueryResolver,
    AdminOrderMutationResolver,
    AdminNotificationMutationResolver,
    AdminRegionQueryResolver,
    AdminRegionMutationResolver,
    AdminAuditQueryResolver,
    AdminDashboardQueryResolver,
    AdminUploadMutationResolver,
  ],
})
export class AdminModule {}
