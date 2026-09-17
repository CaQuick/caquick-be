import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import { sliceIdCursorPage } from '@/common/utils/pagination';
import { DEFAULT_STORE_PRODUCTS_LIMIT } from '@/features/product/constants/product-storefront.constants';
import type { StoreProductsInput } from '@/features/product/dto/inputs/store-products.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductCardService } from '@/features/product/services/product-card.service';
import { toStoreProductCategory } from '@/features/product/services/product-storefront-mappers.helper';
import type {
  StoreProductCategory,
  StoreProductConnection,
} from '@/features/product/types/product-storefront-output.type';

@Injectable()
export class ProductStorefrontService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly cards: ProductCardService,
  ) {}

  /** 매장 상품 목록(커서). 활성 상품만. 카테고리/검색 필터. 카드는 공용 ProductCardService. */
  async storeProducts(
    input: StoreProductsInput,
    accountId?: bigint,
  ): Promise<StoreProductConnection> {
    const limit = input.limit ?? DEFAULT_STORE_PRODUCTS_LIMIT;
    const search = input.search?.trim();
    const scope = {
      storeId: parseId(input.storeId),
      categoryId: input.categoryId ? parseId(input.categoryId) : undefined,
      search: search ? search : undefined,
    };
    const [rows, totalCount] = await Promise.all([
      this.repo.listActiveProductsByStore({
        ...scope,
        limit,
        cursor: input.cursor ? parseIdCursor(input.cursor) : undefined,
      }),
      this.repo.countActiveProductsByStore(scope),
    ]);

    const page = sliceIdCursorPage(rows, limit);
    const cards = await this.cards.buildCards(page.items, accountId);
    return {
      items: page.items.map((row, idx) => ({
        product: cards[idx],
        description: row.description,
        currency: row.currency,
        categoryIds: row.product_categories.map((pc) =>
          pc.category_id.toString(),
        ),
      })),
      totalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  /** 매장 보유 카테고리(사이드바). 빈 카테고리 제외. */
  async storeProductCategories(
    storeId: string,
  ): Promise<StoreProductCategory[]> {
    const rows = await this.repo.listStoreProductCategories(parseId(storeId));
    return rows.map(toStoreProductCategory);
  }
}
