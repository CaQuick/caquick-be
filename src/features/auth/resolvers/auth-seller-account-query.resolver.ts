import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import { SellerAccountService } from '@/features/auth/services/auth-seller-account.service';
import type { SellerAccountOutput } from '@/features/auth/types/auth-seller-output.type';
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
@Roles('SELLER')
export class SellerAccountQueryResolver {
  constructor(private readonly accountService: SellerAccountService) {}

  @Query('sellerMe')
  sellerMe(@CurrentUser() user: JwtUser): Promise<SellerAccountOutput> {
    return this.accountService.sellerMe(parseAccountId(user));
  }
}
