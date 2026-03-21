import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '../../../common/utils/id-parser';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '../../../global/auth';
import { SellerProductService } from '../services/seller-product.service';
import type { SellerProductListInput } from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerProductOutput,
} from '../types/seller-output.type';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerProductQueryResolver {
  constructor(private readonly productService: SellerProductService) {}

  @Query('sellerProducts')
  sellerProducts(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerProductListInput,
  ): Promise<SellerCursorConnection<SellerProductOutput>> {
    const accountId = parseAccountId(user);
    return this.productService.sellerProducts(accountId, input);
  }

  @Query('sellerProduct')
  sellerProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.productService.sellerProduct(accountId, parseId(productId));
  }
}
