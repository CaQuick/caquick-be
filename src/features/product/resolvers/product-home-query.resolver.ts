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

/**
 * 홈 화면 섹션 조회 resolver. 개인화 필드가 없는 public query(인증 불필요).
 */
@Resolver('Query')
export class ProductHomeQueryResolver {
  constructor(private readonly service: ProductHomeService) {}

  @Query('popularCakes')
  popularCakes(
    @Args('input') input?: PopularCakesInput,
  ): Promise<PopularCakesResult> {
    return this.service.popularCakes(input);
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
