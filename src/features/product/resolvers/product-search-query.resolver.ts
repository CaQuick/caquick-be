import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { SearchProductsInput } from '@/features/product/dto/inputs/search-products.input';
import { ProductSearchService } from '@/features/product/services/product-search.service';
import type { SearchProductConnection } from '@/features/product/types/product-search-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 키워드 상품 검색 resolver. 비로그인도 접근 가능한 public query.
 * 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다.
 */
@Resolver('Query')
export class ProductSearchQueryResolver {
  constructor(private readonly service: ProductSearchService) {}

  @Query('searchProducts')
  @UseGuards(OptionalJwtAuthGuard)
  searchProducts(
    @Args('input') input: SearchProductsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<SearchProductConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.searchProducts(input, accountId);
  }
}
