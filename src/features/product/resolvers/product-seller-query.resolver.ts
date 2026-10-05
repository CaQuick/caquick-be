import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { SellerProductListInput } from '@/features/product/dto/inputs/seller-product-list.input';
import { SellerTagSearchInput } from '@/features/product/dto/inputs/seller-tag-search.input';
import { SellerProductQueryService } from '@/features/product/services/product-seller-query.service';
import { SellerProductTaxonomyService } from '@/features/product/services/product-seller-taxonomy.service';
import type {
  SellerProductOutput,
  SellerTagSuggestionOutput,
} from '@/features/product/types/product-seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerProductQueryResolver {
  constructor(
    private readonly productQuery: SellerProductQueryService,
    private readonly taxonomy: SellerProductTaxonomyService,
  ) {}

  @Query('sellerProducts')
  sellerProducts(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerProductListInput,
  ): Promise<CursorConnection<SellerProductOutput>> {
    const accountId = parseAccountId(user);
    return this.productQuery.sellerProducts(accountId, input);
  }

  @Query('sellerProduct')
  sellerProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productQuery.sellerProduct(accountId, parseId(productId));
  }

  @Query('sellerSearchTags')
  sellerSearchTags(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerTagSearchInput,
  ): Promise<SellerTagSuggestionOutput[]> {
    const accountId = parseAccountId(user);
    return this.taxonomy.sellerSearchTags(accountId, input);
  }
}
