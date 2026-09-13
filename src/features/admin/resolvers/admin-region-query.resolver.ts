import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { AdminRegionListInput } from '@/features/admin/dto/inputs/admin-region-list.input';
import { AdminRegionService } from '@/features/admin/services/admin-region.service';
import type { AdminRegionOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminRegionQueryResolver {
  constructor(private readonly regionService: AdminRegionService) {}

  @Query('adminRegions')
  adminRegions(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminRegionListInput,
  ): Promise<AdminRegionOutput[]> {
    return this.regionService.adminRegions(parseAccountId(user), input);
  }
}
