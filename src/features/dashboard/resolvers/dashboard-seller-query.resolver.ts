import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { SellerDashboardInput } from '@/features/dashboard/dto/inputs/seller-dashboard.input';
import { SellerDashboardService } from '@/features/dashboard/services/dashboard-seller.service';
import type { SellerDashboardOutput } from '@/features/dashboard/types/dashboard-seller-output.type';
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
export class SellerDashboardQueryResolver {
  constructor(private readonly dashboardService: SellerDashboardService) {}

  @Query('sellerDashboard')
  sellerDashboard(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerDashboardInput,
  ): Promise<SellerDashboardOutput> {
    return this.dashboardService.sellerDashboard(parseAccountId(user), input);
  }
}
