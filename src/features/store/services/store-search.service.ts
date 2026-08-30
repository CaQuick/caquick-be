import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { roundRatingAverage } from '@/common/utils/rating';
import { parseSearchKeyword } from '@/common/utils/search-keyword';
import {
  DEFAULT_SEARCH_PAGE_LIMIT,
  MAX_SEARCH_PAGE_LIMIT,
} from '@/features/store/constants/store-search.constants';
import type { SearchStoresInput } from '@/features/store/dto/inputs/search-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import {
  StoreRepository,
  type StoreSearchFilter,
} from '@/features/store/repositories/store.repository';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
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
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly listing: StoreListingService,
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
    const pageStoreIds = page.map((entry) => entry.candidate.id);

    const [imagesByStore, wishlistedIds] = await Promise.all([
      this.repo.findStoreCakeImages(pageStoreIds),
      // 0n도 유효한 계정 id — undefined로만 비로그인을 분기한다
      accountId !== undefined
        ? this.wishlistRepo.findWishlistedStoreIds({
            accountId,
            storeIds: pageStoreIds,
          })
        : Promise.resolve(new Set<string>()),
    ]);

    return {
      items: page.map(({ candidate, metrics }) => ({
        id: candidate.id.toString(),
        storeName: candidate.store_name,
        profileImageUrl: candidate.profile_image_url,
        ratingAverage: roundRatingAverage(metrics.ratingAverage),
        reviewCount: metrics.reviewCount,
        regionLabel: buildRegionLabel(candidate),
        cakeImageUrls: imagesByStore.get(candidate.id) ?? [],
        isWishlisted: wishlistedIds.has(candidate.id.toString()),
      })),
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
