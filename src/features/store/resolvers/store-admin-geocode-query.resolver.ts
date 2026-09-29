import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { AdminGeocodeService } from '@/features/store/services/store-admin-geocode.service';
import type { AdminGeocodeResultOutput } from '@/features/store/types/store-admin-geocode-output.type';
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
export class AdminGeocodeQueryResolver {
  constructor(private readonly geocodeService: AdminGeocodeService) {}

  @Query('adminGeocodeAddress')
  adminGeocodeAddress(
    @CurrentUser() user: JwtUser,
    @Args('query') query: string,
  ): Promise<AdminGeocodeResultOutput | null> {
    return this.geocodeService.adminGeocodeAddress(parseAccountId(user), query);
  }
}
