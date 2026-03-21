import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import type { SellerProductListInput } from '@/features/seller/types/seller-input.type';
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
  constructor(private readonly productService: SellerProductCrudService) {}

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
