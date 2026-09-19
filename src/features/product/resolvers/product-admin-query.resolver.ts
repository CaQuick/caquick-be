import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminProductListInput } from '@/features/product/dto/inputs/admin-product-list.input';
import { AdminProductService } from '@/features/product/services/product-admin.service';
import type {
  AdminProductDetailOutput,
  AdminProductOutput,
} from '@/features/product/types/product-admin-output.type';
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
@Roles('ADMIN')
export class AdminProductQueryResolver {
  constructor(private readonly productService: AdminProductService) {}

  @Query('adminProducts')
  adminProducts(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminProductListInput,
  ): Promise<CursorConnection<AdminProductOutput>> {
    return this.productService.adminProducts(parseAccountId(user), input);
  }

  @Query('adminProduct')
  adminProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<AdminProductDetailOutput> {
    return this.productService.adminProduct(
      parseAccountId(user),
      parseId(productId),
    );
  }
}
