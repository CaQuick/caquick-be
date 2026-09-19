import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { ReviewModule } from '@/features/review';
import { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { AdminStoreMutationResolver } from '@/features/store/resolvers/store-admin-mutation.resolver';
import { AdminStoreQueryResolver } from '@/features/store/resolvers/store-admin-query.resolver';
import { AdminSellerMutationResolver } from '@/features/store/resolvers/store-admin-seller-mutation.resolver';
import { AdminSellerQueryResolver } from '@/features/store/resolvers/store-admin-seller-query.resolver';
import { StoreDetailQueryResolver } from '@/features/store/resolvers/store-detail-query.resolver';
import { StorePickupScheduleQueryResolver } from '@/features/store/resolvers/store-pickup-schedule-query.resolver';
import { StoreQueryResolver } from '@/features/store/resolvers/store-query.resolver';
import { StoreSearchQueryResolver } from '@/features/store/resolvers/store-search-query.resolver';
import { SellerAuditQueryResolver } from '@/features/store/resolvers/store-seller-audit-query.resolver';
import { SellerStoreMutationResolver } from '@/features/store/resolvers/store-seller-mutation.resolver';
import { SellerStoreQueryResolver } from '@/features/store/resolvers/store-seller-query.resolver';
import { StoreTodayPickupQueryResolver } from '@/features/store/resolvers/store-today-pickup-query.resolver';
import { StoreWishlistMutationResolver } from '@/features/store/resolvers/store-wishlist-mutation.resolver';
import { StoreWishlistQueryResolver } from '@/features/store/resolvers/store-wishlist-query.resolver';
import { AdminSellerService } from '@/features/store/services/store-admin-seller.service';
import { AdminStoreService } from '@/features/store/services/store-admin.service';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreDetailService } from '@/features/store/services/store-detail.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import { StoreSearchService } from '@/features/store/services/store-search.service';
import { SellerAuditService } from '@/features/store/services/store-seller-audit.service';
import { SellerFaqService } from '@/features/store/services/store-seller-faq.service';
import { SellerStoreHoursService } from '@/features/store/services/store-seller-hours.service';
import { SellerStorePolicyService } from '@/features/store/services/store-seller-policy.service';
import { SellerStoreProfileService } from '@/features/store/services/store-seller-profile.service';
import { StoreTodayPickupService } from '@/features/store/services/store-today-pickup.service';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';

@Module({
  // AuthModule: 관리자 컨텍스트·판매자 계정 생성 tx(AccountAdminRepository)
  imports: [ReviewModule, AuditLogModule, AuthModule],
  providers: [
    StoreRepository,
    StoreStatsRepository,
    StoreCardService,
    StoreListingService,
    StoreWishlistService,
    StoreDetailService,
    StoreQueryResolver,
    StoreWishlistMutationResolver,
    StoreWishlistQueryResolver,
    StoreDetailQueryResolver,
    StoreTodayPickupService,
    StoreTodayPickupQueryResolver,
    StorePickupScheduleService,
    StorePickupScheduleQueryResolver,
    StoreSearchService,
    StoreSearchQueryResolver,
    // 판매자 매장 관리(내 매장·영업시간·휴무·일별 수량·FAQ) — 매장 도메인이 소유한다
    StoreSellerRepository,
    SellerStoreProfileService,
    SellerStoreHoursService,
    SellerStorePolicyService,
    SellerFaqService,
    SellerStoreQueryResolver,
    SellerStoreMutationResolver,
    // 내 매장 감사 로그 — 조회 범위(내 매장·내 행위)는 audit-log 포트가, 판매자 컨텍스트는 store가 가진다
    SellerAuditService,
    SellerAuditQueryResolver,
    // 관리자 판매자 온보딩(판매자 계정+매장 생성·비밀번호 초기화·목록) — 매장 생성이 핵심이라 catalog가 가진다
    AdminSellerService,
    AdminSellerQueryResolver,
    AdminSellerMutationResolver,
    // 관리자 매장 관리(목록·상세·기본 정보 수정·노출 토글)
    StoreAdminRepository,
    AdminStoreService,
    AdminStoreQueryResolver,
    AdminStoreMutationResolver,
  ],
  // StorePickupScheduleService는 주문 생성(order feature)의 픽업 일시 재검증이,
  // StoreSearchService는 검색 요약(search feature)의 매장 건수가 소비한다
  // StoreSellerRepository는 판매자 컨텍스트(계정→매장) 조회로 seller 파생 서비스 전부가 쓴다
  exports: [
    StorePickupScheduleService,
    StoreSearchService,
    StoreStatsRepository,
    StoreSellerRepository,
  ],
})
export class StoreModule {}
