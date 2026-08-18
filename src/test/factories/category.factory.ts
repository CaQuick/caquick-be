import type { Category, CategoryType, PrismaClient } from '@prisma/client';

import { nextSeq } from '@/test/factories/sequence';

export interface CategoryOverrides {
  category_type?: CategoryType;
  name?: string;
  sort_order?: number;
  is_active?: boolean;
  deleted_at?: Date | null;
}

export async function createCategory(
  prisma: PrismaClient,
  overrides: CategoryOverrides = {},
): Promise<Category> {
  const seq = nextSeq();

  return prisma.category.create({
    data: {
      category_type: overrides.category_type ?? 'EVENT',
      name: overrides.name ?? `Category ${seq}`,
      sort_order: overrides.sort_order ?? seq,
      is_active: overrides.is_active ?? true,
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}

/** 상품 ↔ 카테고리 연결. */
export async function linkProductCategory(
  prisma: PrismaClient,
  args: { productId: bigint; categoryId: bigint },
): Promise<void> {
  await prisma.productCategory.create({
    data: {
      product_id: args.productId,
      category_id: args.categoryId,
    },
  });
}
