import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminCreateSellerInput } from '@/features/auth/dto/inputs/admin-create-seller.input';
import { AdminResetSellerPasswordInput } from '@/features/auth/dto/inputs/admin-reset-seller-password.input';
import { AdminSellerService } from '@/features/auth/services/auth-admin-seller.service';
import type { AdminSellerOutput } from '@/features/auth/types/auth-admin-output.type';
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
