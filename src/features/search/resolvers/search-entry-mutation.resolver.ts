import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SearchEntryService } from '@/features/search/services/search-entry.service';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 검색 실행 기록 resolver. 비로그인도 호출 가능(집계 이벤트만), 로그인 시 최근 검색어까지 갱신.
 */
@Resolver('Mutation')
export class SearchEntryMutationResolver {
  constructor(private readonly service: SearchEntryService) {}

  @Mutation('recordSearch')
  @UseGuards(OptionalJwtAuthGuard)
  recordSearch(
    @Args('keyword') keyword: string,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<boolean> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.recordSearch(keyword, accountId);
  }
}
