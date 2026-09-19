import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminCreateSellerInput } from '@/features/store/dto/inputs/admin-create-seller.input';
import { AdminResetSellerPasswordInput } from '@/features/store/dto/inputs/admin-reset-seller-password.input';
import { AdminSellerService } from '@/features/store/services/store-admin-seller.service';
import type { AdminSellerOutput } from '@/features/store/types/store-admin-seller-output.type';
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
export class AdminSellerMutationResolver {
  constructor(private readonly sellerService: AdminSellerService) {}

  @Mutation('adminCreateSeller')
  adminCreateSeller(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateSellerInput,
  ): Promise<AdminSellerOutput> {
    return this.sellerService.adminCreateSeller(parseAccountId(user), input);
  }

  @Mutation('adminResetSellerPassword')
  adminResetSellerPassword(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminResetSellerPasswordInput,
  ): Promise<boolean> {
    return this.sellerService.adminResetSellerPassword(
      parseAccountId(user),
      input,
    );
  }
}
