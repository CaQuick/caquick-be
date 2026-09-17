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

/** 검색 요약(searchSummary)이 넘기는 공통 조건. */
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

  /**
   * 키워드 매장 검색. 후보를 매장명으로 좁힌 뒤 인기 매장과 동일 산식으로 정렬(정렬 옵션 없음 —
   * 시안에 매장용 정렬 시트가 없어 인기순 고정, 사용자 확정), offset 페이지의 대표 이미지·찜을 채운다.
   */
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

  /** 검색 요약 탭의 매장 건수. */
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
