import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { parseSearchKeyword } from '@/common/utils/search-keyword';
import { ProductSearchService } from '@/features/product';
import type { SearchSummaryInput } from '@/features/search/dto/inputs/search-summary.input';
import type { SearchSummary } from '@/features/search/types/search-result-output.type';
import { StoreSearchService } from '@/features/store';

@Injectable()
export class SearchResultService {
  constructor(
    private readonly productSearch: ProductSearchService,
    private readonly storeSearch: StoreSearchService,
  ) {}

  /** '전체' 탭 카운트. 각 도메인의 검색 조건(where 빌더)을 그대로 세어 목록과 어긋나지 않게 한다. */
  async searchSummary(input: SearchSummaryInput): Promise<SearchSummary> {
    const { words } = parseSearchKeyword(input.keyword);
    const regionIds =
      input.regionIds && input.regionIds.length > 0
        ? input.regionIds.map((id) => parseId(id))
        : undefined;

    const [productCount, storeCount] = await Promise.all([
      this.productSearch.countProducts({ words, regionIds }),
      this.storeSearch.countStores({ words, regionIds }),
    ]);
    return { productCount, storeCount };
  }
}
