import { Inject, UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerProductListInput } from '@/features/seller/dto/inputs/seller-product-list.input';
import {
  SELLER_PRODUCT_QUERY_SERVICE,
  type ISellerProductQueryService,
} from '@/features/seller/services/seller-product-query.service.interface';
import type {
  SellerCursorConnection,
  SellerProductOutput,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerProductQueryResolver {
  constructor(
    @Inject(SELLER_PRODUCT_QUERY_SERVICE)
    private readonly productQuery: ISellerProductQueryService,
  ) {}

  @Query('sellerProducts')
  sellerProducts(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerProductListInput,
  ): Promise<SellerCursorConnection<SellerProductOutput>> {
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
}
