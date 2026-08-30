import { BadRequestException, Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { DAY_MS } from '@/common/utils/kst-time';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { parseSearchKeyword } from '@/common/utils/search-keyword';
import { PRODUCT_SEARCH_ERROR_MESSAGES } from '@/features/product/constants/product-search-error-messages';
import {
  DEFAULT_PRODUCT_SEARCH_SORT,
  DEFAULT_SEARCH_PAGE_LIMIT,
  MAX_SEARCH_PAGE_LIMIT,
  type ProductSearchSort,
} from '@/features/product/constants/product-search.constants';
import type { SearchProductFacetsInput } from '@/features/product/dto/inputs/search-product-facets.input';
import type { SearchProductsInput } from '@/features/product/dto/inputs/search-products.input';
import {
  ProductRepository,
  type ProductSearchCandidateRow,
  type ProductSearchFilter,
} from '@/features/product/repositories/product.repository';
import {
  buildPriceBuckets,
  displayPrice,
  toSearchProduct,
} from '@/features/product/services/product-search-mappers.helper';
import type {
  SearchProductConnection,
  SearchProductFacets,
} from '@/features/product/types/product-search-output.type';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  RANKING_RECENT_ORDER_DAYS,
  scoreAndSortByPopularity,
} from '@/features/store';

/** 검색 요약(searchSummary)이 넘기는 공통 조건 — 정렬·가격·카테고리 없이 키워드+지역만. */
export interface ProductSearchScope {
  words: string[];
  regionIds?: bigint[];
}

@Injectable()
export class ProductSearchService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly clock: ClockService,
  ) {}

  /**
   * 키워드 상품 검색. 후보 전량을 로드해 정렬 후 offset 페이지를 자르고, 페이지 상품만
   * 평점·찜 여부를 채운다. 인기/판매순은 메모리 점수화라 DB 페이지네이션이 불가해
   * 정렬 5종을 같은 파이프라인으로 통일했다(자체 판단 — 인기 매장과 동일 트레이드오프).
   */
  async searchProducts(
    input: SearchProductsInput,
    accountId?: bigint,
  ): Promise<SearchProductConnection> {
    const filter = this.toFilter(input);
    const offset = input.offset ?? 0;
    const limit = Math.min(
      input.limit ?? DEFAULT_SEARCH_PAGE_LIMIT,
      MAX_SEARCH_PAGE_LIMIT,
    );
    const sort = input.sort ?? DEFAULT_PRODUCT_SEARCH_SORT;

    const candidates = await this.repo.findProductSearchCandidates(filter);
    const totalCount = candidates.length;
    if (totalCount === 0) return { items: [], totalCount: 0, hasMore: false };

    const sorted = await this.sortCandidates(candidates, sort);
    const page = sorted.slice(offset, offset + limit);
    const pageIds = page.map((row) => row.id);

    const [reviewStats, wishlistedIds] = await Promise.all([
      this.repo.aggregateProductReviewStats(pageIds),
      // 0n도 유효한 계정 id — undefined로만 비로그인을 분기한다
      accountId !== undefined
        ? this.repo.findWishlistedProductIds({ accountId, productIds: pageIds })
        : Promise.resolve(new Set<string>()),
    ]);

    return {
      items: page.map((row) =>
        toSearchProduct(
          row,
          reviewStats.get(row.id),
          wishlistedIds.has(row.id.toString()),
        ),
      ),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }

  /**
   * 가격대 시트 히스토그램. 가격 조건을 뺀 나머지 조건(키워드·카테고리·지역)으로 표시가를
   * 모아 5,000원 버킷으로 센다. 상품 수 소규모 전제의 메모리 집계(자체 판단 — 규모가 커지면
   * SQL FLOOR 그룹핑으로 전환). 'N개 상품보기' 카운트는 searchProducts.totalCount를 쓴다.
   */
  async searchProductFacets(
    input: SearchProductFacetsInput,
  ): Promise<SearchProductFacets> {
    const filter = this.toFilter({
      ...input,
      minPrice: undefined,
      maxPrice: undefined,
    });
    const rows = await this.repo.findProductSearchPrices(filter);
    const prices = rows.map(displayPrice);
    // spread(Math.min(...prices))는 대략 12만 개 이상에서 인자 개수 한도로 터진다 — 순회로 방어
    let minPrice: number | null = null;
    let maxPrice: number | null = null;
    for (const price of prices) {
      if (minPrice === null || price < minPrice) minPrice = price;
      if (maxPrice === null || price > maxPrice) maxPrice = price;
    }
    return {
      buckets: buildPriceBuckets(prices),
      minPrice,
      maxPrice,
      totalCount: prices.length,
    };
  }

  /** 검색 요약 탭의 상품 건수(필터·정렬 없이 키워드+지역). */
  countProducts(scope: ProductSearchScope): Promise<number> {
    return this.repo.countProductSearch(scope);
  }

  private toFilter(
    input: Pick<
      SearchProductsInput,
      | 'keyword'
      | 'eventCategoryIds'
      | 'styleCategoryIds'
      | 'minPrice'
      | 'maxPrice'
      | 'regionIds'
    >,
  ): ProductSearchFilter {
    const { words } = parseSearchKeyword(input.keyword);
    if (
      input.minPrice !== undefined &&
      input.maxPrice !== undefined &&
      input.minPrice > input.maxPrice
    ) {
      throw new BadRequestException(
        PRODUCT_SEARCH_ERROR_MESSAGES.INVALID_PRICE_RANGE,
      );
    }
    const ids = (raw?: string[]): bigint[] | undefined =>
      raw && raw.length > 0 ? raw.map((id) => parseId(id)) : undefined;
    return {
      words,
      eventCategoryIds: ids(input.eventCategoryIds),
      styleCategoryIds: ids(input.styleCategoryIds),
      // GraphQL nullable 필드는 명시적 null도 오므로 null/undefined 모두 '미지정'
      minPrice: input.minPrice ?? undefined,
      maxPrice: input.maxPrice ?? undefined,
      regionIds: ids(input.regionIds),
    };
  }

  private async sortCandidates(
    candidates: ProductSearchCandidateRow[],
    sort: ProductSearchSort,
  ): Promise<ProductSearchCandidateRow[]> {
    switch (sort) {
      case 'POPULAR':
        return this.sortByPopularity(candidates);
      case 'BEST_SELLING':
        return this.sortByRecentSales(candidates);
      case 'LATEST':
        return [...candidates].sort(
          (a, b) =>
            b.created_at.getTime() - a.created_at.getTime() ||
            compareIdDesc(a, b),
        );
      case 'PRICE_ASC':
        return [...candidates].sort(
          (a, b) => displayPrice(a) - displayPrice(b) || compareIdDesc(a, b),
        );
      case 'PRICE_DESC':
        return [...candidates].sort(
          (a, b) => displayPrice(b) - displayPrice(a) || compareIdDesc(a, b),
        );
    }
  }

  /** 인기 케이크·인기 매장과 동일 산식(최근 주문·찜·베이지안 평점). */
  private async sortByPopularity(
    candidates: ProductSearchCandidateRow[],
  ): Promise<ProductSearchCandidateRow[]> {
    const ids = candidates.map((c) => c.id);
    const since = new Date(
      this.clock.now().getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );
    const [wishlistCounts, reviewStats, recentOrderCounts, globalAverage] =
      await Promise.all([
        this.repo.aggregateProductWishlistCounts(ids),
        this.repo.aggregateProductReviewStats(ids),
        this.repo.aggregateProductRecentOrderCounts(ids, since),
        this.repo.globalReviewAverage(),
      ]);
    return scoreAndSortByPopularity(
      candidates,
      { wishlistCounts, reviewStats, recentOrderCounts },
      globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR,
    ).map((entry) => entry.candidate);
  }

  /** 판매순: 최근 30일 유효 주문 수량 합 desc → id desc. 판매 0건도 뒤에 남긴다(검색 결과 누락 방지). */
  private async sortByRecentSales(
    candidates: ProductSearchCandidateRow[],
  ): Promise<ProductSearchCandidateRow[]> {
    const since = new Date(
      this.clock.now().getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );
    const sold = await this.repo.aggregateProductSoldQuantities(
      candidates.map((c) => c.id),
      since,
    );
    return [...candidates].sort(
      (a, b) =>
        (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || compareIdDesc(a, b),
    );
  }
}

function compareIdDesc(a: { id: bigint }, b: { id: bigint }): number {
  if (a.id === b.id) return 0;
  return b.id > a.id ? 1 : -1;
}
