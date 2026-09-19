import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { AdminAuditQueryResolver } from '@/features/dashboard/resolvers/dashboard-admin-audit-query.resolver';
import { AdminDashboardQueryResolver } from '@/features/dashboard/resolvers/dashboard-admin-query.resolver';
import { AdminAuditService } from '@/features/dashboard/services/dashboard-admin-audit.service';
import { AdminDashboardService } from '@/features/dashboard/services/dashboard-admin.service';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { ReviewModule } from '@/features/review';
import { SearchModule } from '@/features/search';
import { StoreModule } from '@/features/store';

/**
 * 관리자 운영 화면의 다도메인 집계(대시보드 요약·검색어 스냅샷·전역 감사 로그). 소유 모델이 없고 각 도메인 배럴을 읽기만 한다.
 * 전역 감사 로그 화면이 audit-log가 아니라 여기 있는 이유: 관리자 컨텍스트(auth)를 audit-log가 import하면 auth ↔ audit-log 순환.
 */
@Module({
  imports: [
    AuthModule,
    AuditLogModule,
    OrderModule,
    StoreModule,
    ProductModule,
    ReviewModule,
    SearchModule,
  ],
  providers: [
    AdminDashboardService,
    AdminAuditService,
    AdminDashboardQueryResolver,
    AdminAuditQueryResolver,
  ],
})
export class DashboardModule {}
