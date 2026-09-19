import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminSetProductActiveInput } from '@/features/product/dto/inputs/admin-set-product-active.input';
import { AdminProductService } from '@/features/product/services/product-admin.service';
import type { AdminProductOutput } from '@/features/product/types/product-admin-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminProductMutationResolver {
  constructor(private readonly productService: AdminProductService) {}

  @Mutation('adminSetProductActive')
  adminSetProductActive(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminSetProductActiveInput,
  ): Promise<AdminProductOutput> {
    return this.productService.adminSetProductActive(
      parseAccountId(user),
      input,
    );
  }
}
