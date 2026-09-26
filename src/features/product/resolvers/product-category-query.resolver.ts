import { Args, Query, Resolver } from '@nestjs/graphql';

import { CategoriesInput } from '@/features/product/dto/inputs/categories.input';
import { ProductCategoryService } from '@/features/product/services/product-category.service';
import type { CategoryItem } from '@/features/product/types/product-category-output.type';

@Resolver('Query')
export class ProductCategoryQueryResolver {
  constructor(private readonly service: ProductCategoryService) {}

  @Query('categories')
  categories(@Args('input') input?: CategoriesInput): Promise<CategoryItem[]> {
    return this.service.categories(input);
  }
}
