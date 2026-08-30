import { Module } from '@nestjs/common';

import { ProductModule } from '@/features/product';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import { SearchEntryMutationResolver } from '@/features/search/resolvers/search-entry-mutation.resolver';
import { SearchEntryQueryResolver } from '@/features/search/resolvers/search-entry-query.resolver';
import { SearchResultQueryResolver } from '@/features/search/resolvers/search-result-query.resolver';
import { SearchEntryService } from '@/features/search/services/search-entry.service';
import { SearchKeywordRankScheduler } from '@/features/search/services/search-keyword-rank.scheduler';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';
import { SearchResultService } from '@/features/search/services/search-result.service';
import { StoreModule } from '@/features/store';

/**
 * 검색 도메인 모듈(검색 진입 화면·검색어 기록·인기 검색어 스냅샷).
 * 크론(@nestjs/schedule)은 AppModule의 ScheduleModule.forRoot()가 활성화한다.
 */
@Module({
  imports: [ProductModule, StoreModule],
  providers: [
    SearchRepository,
    SearchEntryService,
    SearchKeywordRankService,
    SearchKeywordRankScheduler,
    SearchEntryQueryResolver,
    SearchEntryMutationResolver,
    SearchResultService,
    SearchResultQueryResolver,
  ],
})
export class SearchModule {}
