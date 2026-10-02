import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { ProductModule } from '@/features/product';
import { SearchAdminRepository } from '@/features/search/repositories/search-admin.repository';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import { AdminSearchKeywordChipMutationResolver } from '@/features/search/resolvers/search-admin-mutation.resolver';
import { AdminSearchKeywordChipQueryResolver } from '@/features/search/resolvers/search-admin-query.resolver';
import { SearchEntryMutationResolver } from '@/features/search/resolvers/search-entry-mutation.resolver';
import { SearchEntryQueryResolver } from '@/features/search/resolvers/search-entry-query.resolver';
import { UserSearchMutationResolver } from '@/features/search/resolvers/search-history-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/search/resolvers/search-history-query.resolver';
import { SearchResultQueryResolver } from '@/features/search/resolvers/search-result-query.resolver';
import { AdminSearchKeywordChipService } from '@/features/search/services/search-admin.service';
import { SearchEntryService } from '@/features/search/services/search-entry.service';
import { UserSearchService } from '@/features/search/services/search-history.service';
import { SearchKeywordRankScheduler } from '@/features/search/services/search-keyword-rank.scheduler';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';
import { SearchResultService } from '@/features/search/services/search-result.service';
import { StoreModule } from '@/features/store';

/** 크론(@nestjs/schedule)은 AppModule의 ScheduleModule.forRoot()가 활성화한다. */
@Module({
  imports: [ProductModule, StoreModule, AuthModule, AuditLogModule],
  providers: [
    SearchRepository,
    SearchEntryService,
    SearchKeywordRankService,
    SearchKeywordRankScheduler,
    SearchEntryQueryResolver,
    SearchEntryMutationResolver,
    SearchResultService,
    SearchResultQueryResolver,
    // 구매자 최근 검색어(목록·삭제) — 검색 도메인이 소유한다
    UserSearchService,
    UserSearchQueryResolver,
    UserSearchMutationResolver,
    // 관리자 검색 키워드 바로가기 칩
    SearchAdminRepository,
    AdminSearchKeywordChipService,
    AdminSearchKeywordChipQueryResolver,
    AdminSearchKeywordChipMutationResolver,
  ],
  exports: [SearchRepository],
})
export class SearchModule {}
