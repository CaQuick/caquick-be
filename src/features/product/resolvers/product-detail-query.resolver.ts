import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { ProductDetailService } from '@/features/product/services/product-detail.service';
import type { ProductDetail } from '@/features/product/types/product-detail-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 구매자 상품 상세 resolver. 비로그인도 접근 가능한 public query.
 * 옵셔널 인증으로 로그인 시에만 isWishlisted를 채운다.
 */
@Resolver('Query')
export class ProductDetailQueryResolver {
  constructor(private readonly service: ProductDetailService) {}

  @Query('productDetail')
  @UseGuards(OptionalJwtAuthGuard)
  productDetail(
    @Args('productId') productId: string,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<ProductDetail> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.productDetail(productId, accountId);
  }
}
