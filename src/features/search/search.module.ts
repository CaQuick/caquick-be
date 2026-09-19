import { Module } from '@nestjs/common';

import { AuthModule } from '@/features/auth';
import { ProductModule } from '@/features/product';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import { SearchEntryMutationResolver } from '@/features/search/resolvers/search-entry-mutation.resolver';
import { SearchEntryQueryResolver } from '@/features/search/resolvers/search-entry-query.resolver';
import { UserSearchMutationResolver } from '@/features/search/resolvers/search-history-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/search/resolvers/search-history-query.resolver';
import { SearchResultQueryResolver } from '@/features/search/resolvers/search-result-query.resolver';
import { SearchEntryService } from '@/features/search/services/search-entry.service';
import { UserSearchService } from '@/features/search/services/search-history.service';
import { SearchKeywordRankScheduler } from '@/features/search/services/search-keyword-rank.scheduler';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';
import { SearchResultService } from '@/features/search/services/search-result.service';
import { StoreModule } from '@/features/store';

/** 크론(@nestjs/schedule)은 AppModule의 ScheduleModule.forRoot()가 활성화한다. */
@Module({
  imports: [ProductModule, StoreModule, AuthModule],
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
  ],
  exports: [SearchRepository],
})
export class SearchModule {}
