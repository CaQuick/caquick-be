import { Args, Query, Resolver } from '@nestjs/graphql';

import { StoreProductsInput } from '@/features/product/dto/inputs/store-products.input';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';
import type {
  StoreProductCategory,
  StoreProductConnection,
} from '@/features/product/types/product-storefront-output.type';

/**
 * 구매자 매장 상품 조회 resolver. 개인화 필드가 없는 public query(인증 불필요).
 */
@Resolver('Query')
export class ProductStorefrontQueryResolver {
  constructor(private readonly service: ProductStorefrontService) {}

  @Query('storeProducts')
  storeProducts(
    @Args('input') input: StoreProductsInput,
  ): Promise<StoreProductConnection> {
    return this.service.storeProducts(input);
  }

  @Query('storeProductCategories')
  storeProductCategories(
    @Args('storeId') storeId: string,
  ): Promise<StoreProductCategory[]> {
    return this.service.storeProductCategories(storeId);
  }
}
