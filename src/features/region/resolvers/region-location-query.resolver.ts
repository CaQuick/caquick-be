import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { RegionByLocationInput } from '@/features/region/dto/inputs/region-by-location.input';
import { RegionLocationService } from '@/features/region/services/region-location.service';
import type { RegionByLocationOutput } from '@/features/region/types/region-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';
import { RateLimit } from '@/global/rate-limit';

/** 비로그인 허용. 로그인 시 계정은 위치정보 이용 확인자료에만 쓴다. */
@Resolver('Query')
export class RegionLocationQueryResolver {
  constructor(private readonly service: RegionLocationService) {}

  @Query('regionByLocation')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ name: 'region-by-location', limit: 30, windowSeconds: 60 })
  regionByLocation(
    @Args('input') input: RegionByLocationInput,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<RegionByLocationOutput | null> {
    return this.service.regionByLocation(
      input,
      user ? parseAccountId(user) : null,
    );
  }
}
