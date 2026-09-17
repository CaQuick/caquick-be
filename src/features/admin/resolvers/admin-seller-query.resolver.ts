import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminSellerListInput } from '@/features/admin/dto/inputs/admin-seller-list.input';
import { AdminSellerService } from '@/features/admin/services/admin-seller.service';
import type { AdminSellerOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminSellerQueryResolver {
  constructor(private readonly sellerService: AdminSellerService) {}

  @Query('adminSellers')
  adminSellers(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminSellerListInput,
  ): Promise<CursorConnection<AdminSellerOutput>> {
    return this.sellerService.adminSellers(parseAccountId(user), input);
  }

  @Query('adminSeller')
  adminSeller(
    @CurrentUser() user: JwtUser,
    @Args('accountId') accountId: string,
  ): Promise<AdminSellerOutput> {
    return this.sellerService.adminSeller(
      parseAccountId(user),
      parseId(accountId),
    );
  }
}
