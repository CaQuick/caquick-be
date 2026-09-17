import { Args, Query, Resolver } from '@nestjs/graphql';

import { SearchSummaryInput } from '@/features/search/dto/inputs/search-summary.input';
import { SearchResultService } from '@/features/search/services/search-result.service';
import type { SearchSummary } from '@/features/search/types/search-result-output.type';

@Resolver('Query')
export class SearchResultQueryResolver {
  constructor(private readonly service: SearchResultService) {}

  @Query('searchSummary')
  searchSummary(
    @Args('input') input: SearchSummaryInput,
  ): Promise<SearchSummary> {
    return this.service.searchSummary(input);
  }
}
