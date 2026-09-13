import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { AdminDashboardSummaryInput } from '@/features/admin/dto/inputs/admin-dashboard-summary.input';
import { AdminSearchKeywordSnapshotInput } from '@/features/admin/dto/inputs/admin-search-keyword-snapshot.input';
import { AdminDashboardService } from '@/features/admin/services/admin-dashboard.service';
import type {
  AdminDashboardSummaryOutput,
  AdminSearchKeywordSnapshotOutput,
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
export class AdminDashboardQueryResolver {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Query('adminDashboardSummary')
  adminDashboardSummary(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminDashboardSummaryInput,
  ): Promise<AdminDashboardSummaryOutput> {
    return this.dashboardService.adminDashboardSummary(
      parseAccountId(user),
      input,
    );
  }

  @Query('adminSearchKeywordSnapshot')
  adminSearchKeywordSnapshot(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminSearchKeywordSnapshotInput,
  ): Promise<AdminSearchKeywordSnapshotOutput> {
    return this.dashboardService.adminSearchKeywordSnapshot(
      parseAccountId(user),
      input,
    );
  }
}
