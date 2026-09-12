import { Module } from '@nestjs/common';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminAccountMutationResolver } from '@/features/admin/resolvers/admin-account-mutation.resolver';
import { AdminAccountQueryResolver } from '@/features/admin/resolvers/admin-account-query.resolver';
import { AdminContentMutationResolver } from '@/features/admin/resolvers/admin-content-mutation.resolver';
import { AdminContentQueryResolver } from '@/features/admin/resolvers/admin-content-query.resolver';
import { AdminProductMutationResolver } from '@/features/admin/resolvers/admin-product-mutation.resolver';
import { AdminProductQueryResolver } from '@/features/admin/resolvers/admin-product-query.resolver';
import { AdminSellerMutationResolver } from '@/features/admin/resolvers/admin-seller-mutation.resolver';
import { AdminSellerQueryResolver } from '@/features/admin/resolvers/admin-seller-query.resolver';
import { AdminStoreMutationResolver } from '@/features/admin/resolvers/admin-store-mutation.resolver';
import { AdminStoreQueryResolver } from '@/features/admin/resolvers/admin-store-query.resolver';
import { AdminUserMutationResolver } from '@/features/admin/resolvers/admin-user-mutation.resolver';
import { AdminUserQueryResolver } from '@/features/admin/resolvers/admin-user-query.resolver';
import { AdminAccountService } from '@/features/admin/services/admin-account.service';
import { AdminBannerService } from '@/features/admin/services/admin-banner.service';
import { AdminProductService } from '@/features/admin/services/admin-product.service';
import { AdminSellerService } from '@/features/admin/services/admin-seller.service';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import { AdminUserService } from '@/features/admin/services/admin-user.service';
import { AuditLogModule } from '@/features/audit-log';

/**
 * 관리자(ADMIN) 도메인 모듈. seller와 대칭 구조이며 cross-feature로 쓰이지 않아 배럴이 없다.
 * DI는 구체 클래스 주입(2번째 구현 예정 없음).
 */
@Module({
  imports: [AuditLogModule],
  providers: [
    AdminRepository,
    AdminAccountService,
    AdminBannerService,
    AdminSellerService,
    AdminUserService,
    AdminStoreService,
    AdminProductService,
    AdminAccountQueryResolver,
    AdminAccountMutationResolver,
    AdminContentQueryResolver,
    AdminContentMutationResolver,
    AdminSellerQueryResolver,
    AdminSellerMutationResolver,
    AdminUserQueryResolver,
    AdminUserMutationResolver,
    AdminStoreQueryResolver,
    AdminStoreMutationResolver,
    AdminProductQueryResolver,
    AdminProductMutationResolver,
  ],
})
export class AdminModule {}
