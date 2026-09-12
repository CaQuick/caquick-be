import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminSetStoreActiveInput } from '@/features/admin/dto/inputs/admin-set-store-active.input';
import { AdminUpdateStoreBasicInfoInput } from '@/features/admin/dto/inputs/admin-update-store-basic-info.input';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import type { AdminStoreOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminStoreMutationResolver {
  constructor(private readonly storeService: AdminStoreService) {}

  @Mutation('adminSetStoreActive')
  adminSetStoreActive(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminSetStoreActiveInput,
  ): Promise<AdminStoreOutput> {
    return this.storeService.adminSetStoreActive(parseAccountId(user), input);
  }

  @Mutation('adminUpdateStoreBasicInfo')
  adminUpdateStoreBasicInfo(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdateStoreBasicInfoInput,
  ): Promise<AdminStoreOutput> {
    return this.storeService.adminUpdateStoreBasicInfo(
      parseAccountId(user),
      input,
    );
  }
}
