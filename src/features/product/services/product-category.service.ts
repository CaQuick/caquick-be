import { Injectable } from '@nestjs/common';

import type { CategoriesInput } from '@/features/product/dto/inputs/categories.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import type { CategoryItem } from '@/features/product/types/product-category-output.type';

@Injectable()
export class ProductCategoryService {
  constructor(private readonly repo: ProductRepository) {}

  /** 전역 카테고리 목록. type 필터 옵션, 활성만. */
  async categories(input?: CategoriesInput): Promise<CategoryItem[]> {
    const rows = await this.repo.listCategories(input?.type);
    return rows.map((row) => ({
      id: row.id.toString(),
      name: row.name,
      categoryType: row.category_type,
      sortOrder: row.sort_order,
    }));
  }
}
