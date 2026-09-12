import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminCreateBannerInput } from '@/features/admin/dto/inputs/admin-create-banner.input';
import { AdminUpdateBannerInput } from '@/features/admin/dto/inputs/admin-update-banner.input';
import { AdminBannerService } from '@/features/admin/services/admin-banner.service';
import type { AdminBannerOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminContentMutationResolver {
  constructor(private readonly bannerService: AdminBannerService) {}

  @Mutation('adminCreateBanner')
  adminCreateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateBannerInput,
  ): Promise<AdminBannerOutput> {
    return this.bannerService.adminCreateBanner(parseAccountId(user), input);
  }

  @Mutation('adminUpdateBanner')
  adminUpdateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdateBannerInput,
  ): Promise<AdminBannerOutput> {
    return this.bannerService.adminUpdateBanner(parseAccountId(user), input);
  }

  @Mutation('adminDeleteBanner')
  adminDeleteBanner(
    @CurrentUser() user: JwtUser,
    @Args('bannerId') bannerId: string,
  ): Promise<boolean> {
    return this.bannerService.adminDeleteBanner(
      parseAccountId(user),
      parseId(bannerId),
    );
  }
}
