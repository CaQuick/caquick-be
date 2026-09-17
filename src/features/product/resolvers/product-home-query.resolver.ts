import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CustomCakeShowcaseInput } from '@/features/product/dto/inputs/custom-cake-showcase.input';
import { PopularCakesInput } from '@/features/product/dto/inputs/popular-cakes.input';
import { RandomCakesInput } from '@/features/product/dto/inputs/random-cakes.input';
import { ProductHomeService } from '@/features/product/services/product-home.service';
import type {
  CustomCakeShowcaseItem,
  PopularCakesResult,
  RandomCakesResult,
} from '@/features/product/types/product-home-output.type';
import {
  CurrentUser,
  OptionalJwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 홈 화면 섹션 조회 resolver. 비로그인도 접근 가능한 public query.
 * popularCakes는 옵셔널 인증으로 로그인 시에만 카드의 isWishlisted를 채운다.
 */
@Resolver('Query')
export class ProductHomeQueryResolver {
  constructor(private readonly service: ProductHomeService) {}

  @Query('popularCakes')
  @UseGuards(OptionalJwtAuthGuard)
  popularCakes(
    @Args('input') input: PopularCakesInput | undefined,
    @CurrentUser() user: JwtUser | undefined,
  ): Promise<PopularCakesResult> {
    const accountId = user ? parseAccountId(user) : undefined;
    return this.service.popularCakes(input, accountId);
  }

  @Query('customCakeShowcase')
  customCakeShowcase(
    @Args('input') input?: CustomCakeShowcaseInput,
  ): Promise<CustomCakeShowcaseItem[]> {
    return this.service.customCakeShowcase(input);
  }

  @Query('randomCakes')
  randomCakes(
    @Args('input') input?: RandomCakesInput,
  ): Promise<RandomCakesResult> {
    return this.service.randomCakes(input);
  }
}
