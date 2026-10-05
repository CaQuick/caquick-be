import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { ConversationModule } from '@/features/conversation';
import { AdminAuditQueryResolver } from '@/features/dashboard/resolvers/dashboard-admin-audit-query.resolver';
import { AdminDashboardQueryResolver } from '@/features/dashboard/resolvers/dashboard-admin-query.resolver';
import { SellerDashboardQueryResolver } from '@/features/dashboard/resolvers/dashboard-seller-query.resolver';
import { AdminAuditService } from '@/features/dashboard/services/dashboard-admin-audit.service';
import { AdminDashboardService } from '@/features/dashboard/services/dashboard-admin.service';
import { SellerDashboardService } from '@/features/dashboard/services/dashboard-seller.service';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { ReviewModule } from '@/features/review';
import { SearchModule } from '@/features/search';
import { StoreModule } from '@/features/store';

/**
 * 관리자 운영 화면(대시보드 요약·검색어 스냅샷·전역 감사 로그)과 판매자 홈의 다도메인 집계. 소유 모델이 없고 각 도메인 배럴을 읽기만 한다.
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
    ConversationModule,
  ],
  providers: [
    AdminDashboardService,
    AdminAuditService,
    AdminDashboardQueryResolver,
    AdminAuditQueryResolver,
    // 판매자 홈 집계
    SellerDashboardService,
    SellerDashboardQueryResolver,
  ],
})
export class DashboardModule {}
