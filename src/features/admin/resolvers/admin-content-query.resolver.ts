import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminBannerListInput } from '@/features/admin/dto/inputs/admin-banner-list.input';
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

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminContentQueryResolver {
  constructor(private readonly bannerService: AdminBannerService) {}

  @Query('adminBanners')
  adminBanners(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminBannerListInput,
  ): Promise<CursorConnection<AdminBannerOutput>> {
    return this.bannerService.adminBanners(parseAccountId(user), input);
  }

  @Query('adminBanner')
  adminBanner(
    @CurrentUser() user: JwtUser,
    @Args('bannerId') bannerId: string,
  ): Promise<AdminBannerOutput> {
    return this.bannerService.adminBanner(
      parseAccountId(user),
      parseId(bannerId),
    );
  }
}
