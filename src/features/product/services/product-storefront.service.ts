import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { sliceCursorPage } from '@/common/utils/pagination';
import { DEFAULT_STORE_PRODUCTS_LIMIT } from '@/features/product/constants/product-storefront.constants';
import type { StoreProductsInput } from '@/features/product/dto/inputs/store-products.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import {
  toStoreProduct,
  toStoreProductCategory,
} from '@/features/product/services/product-storefront-mappers.helper';
import type {
  StoreProductCategory,
  StoreProductConnection,
} from '@/features/product/types/product-storefront-output.type';

@Injectable()
export class ProductStorefrontService {
  constructor(private readonly repo: ProductRepository) {}

  /** 매장 상품 목록(커서). 활성 상품만. 카테고리/검색 필터. */
  async storeProducts(
    input: StoreProductsInput,
  ): Promise<StoreProductConnection> {
    const limit = input.limit ?? DEFAULT_STORE_PRODUCTS_LIMIT;
    const search = input.search?.trim();
    const rows = await this.repo.listActiveProductsByStore({
      storeId: parseId(input.storeId),
      limit,
      cursor: input.cursor ? parseId(input.cursor) : undefined,
      categoryId: input.categoryId ? parseId(input.categoryId) : undefined,
      search: search ? search : undefined,
    });

    const page = sliceCursorPage(rows, limit, (last) => last.id.toString());

    return {
      items: page.items.map(toStoreProduct),
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
