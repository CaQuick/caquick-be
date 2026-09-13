import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminStoreListInput } from '@/features/admin/dto/inputs/admin-store-list.input';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import type {
  AdminCursorConnection,
  AdminStoreDetailOutput,
  AdminStoreOutput,
} from '@/features/admin/types/admin-output.type';
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
export class AdminStoreQueryResolver {
  constructor(private readonly storeService: AdminStoreService) {}

  @Query('adminStores')
  adminStores(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminStoreListInput,
  ): Promise<AdminCursorConnection<AdminStoreOutput>> {
    return this.storeService.adminStores(parseAccountId(user), input);
  }

  @Query('adminStore')
  adminStore(
    @CurrentUser() user: JwtUser,
    @Args('storeId') storeId: string,
  ): Promise<AdminStoreDetailOutput> {
    return this.storeService.adminStore(parseAccountId(user), parseId(storeId));
  }
}
