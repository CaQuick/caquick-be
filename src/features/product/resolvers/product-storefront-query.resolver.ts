import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { StoreProductsInput } from '@/features/product/dto/inputs/store-products.input';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';
import type {
  StoreProductCategory,
  StoreProductConnection,
} from '@/features/product/types/product-storefront-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/** storeProducts는 옵셔널 인증으로 로그인 시에만 카드의 isWishlisted를 채운다. */
@Resolver('Query')
export class ProductStorefrontQueryResolver {
  constructor(private readonly service: ProductStorefrontService) {}

  @Query('storeProducts')
  @UseGuards(OptionalJwtAuthGuard)
  storeProducts(
    @Args('input') input: StoreProductsInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<StoreProductConnection> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.storeProducts(input, accountId);
  }

  @Query('storeProductCategories')
  storeProductCategories(
    @Args('storeId') storeId: string,
  ): Promise<StoreProductCategory[]> {
    return this.service.storeProductCategories(storeId);
  }
}
