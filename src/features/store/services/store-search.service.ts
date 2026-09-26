import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { parseSearchKeyword } from '@/common/utils/search-keyword';
import {
  DEFAULT_SEARCH_PAGE_LIMIT,
  MAX_SEARCH_PAGE_LIMIT,
} from '@/features/store/constants/store-search.constants';
import type { SearchStoresInput } from '@/features/store/dto/inputs/search-stores.input';
import {
  StoreRepository,
  type StoreSearchFilter,
} from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import type { SearchStoreConnection } from '@/features/store/types/store-search-output.type';

export interface StoreSearchScope {
  words: string[];
  regionIds?: bigint[];
}

@Injectable()
export class StoreSearchService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly listing: StoreListingService,
    private readonly cards: StoreCardService,
    private readonly clock: ClockService,
  ) {}

  /** 정렬 옵션 없음 — 시안에 매장용 정렬 시트가 없어 인기순 고정. */
  async searchStores(
    input: SearchStoresInput,
    accountId?: bigint,
  ): Promise<SearchStoreConnection> {
    const filter = this.toFilter(input);
    const offset = input.offset ?? 0;
    const limit = Math.min(
      input.limit ?? DEFAULT_SEARCH_PAGE_LIMIT,
      MAX_SEARCH_PAGE_LIMIT,
    );

    const candidates = await this.repo.findStoreSearchCandidates(filter);
    const totalCount = candidates.length;
    if (totalCount === 0) return { items: [], totalCount: 0, hasMore: false };

    const scored = await this.listing.scoreStores(candidates, this.clock.now());
    const page = scored.slice(offset, offset + limit);
    const items = await this.cards.buildCards(
      page.map((entry) => entry.candidate),
      accountId,
      {
        stats: new Map(
          page.map((entry) => [entry.candidate.id, entry.metrics]),
        ),
      },
    );

    return {
      items,
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }

  countStores(scope: StoreSearchScope): Promise<number> {
    return this.repo.countStoreSearch(scope);
  }

  private toFilter(input: SearchStoresInput): StoreSearchFilter {
    const { words } = parseSearchKeyword(input.keyword);
    return {
      words,
      regionIds:
        input.regionIds && input.regionIds.length > 0
          ? input.regionIds.map((id) => parseId(id))
          : undefined,
    };
  }
}
