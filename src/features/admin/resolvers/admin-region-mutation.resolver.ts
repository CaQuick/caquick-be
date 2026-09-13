import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminCreateRegionInput } from '@/features/admin/dto/inputs/admin-create-region.input';
import { AdminUpdateRegionInput } from '@/features/admin/dto/inputs/admin-update-region.input';
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

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRegionMutationResolver {
  constructor(private readonly regionService: AdminRegionService) {}

  @Mutation('adminCreateRegion')
  adminCreateRegion(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateRegionInput,
  ): Promise<AdminRegionOutput> {
    return this.regionService.adminCreateRegion(parseAccountId(user), input);
  }

  @Mutation('adminUpdateRegion')
  adminUpdateRegion(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdateRegionInput,
  ): Promise<AdminRegionOutput> {
    return this.regionService.adminUpdateRegion(parseAccountId(user), input);
  }

  @Mutation('adminDeleteRegion')
  adminDeleteRegion(
    @CurrentUser() user: JwtUser,
    @Args('regionId') regionId: string,
  ): Promise<boolean> {
    return this.regionService.adminDeleteRegion(
      parseAccountId(user),
      parseId(regionId),
    );
  }
}
