import type {
  AdminCategoryRow,
  AdminTagRow,
} from '@/features/product/repositories/product-admin.repository';
import type {
  AdminCategoryOutput,
  AdminTagOutput,
} from '@/features/product/types/product-admin-output.type';

export function toAdminCategoryOutput(
  row: AdminCategoryRow,
): AdminCategoryOutput {
  return {
    id: row.id.toString(),
    categoryType: row.category_type,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    productCount: row._count.product_categories,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAdminTagOutput(row: AdminTagRow): AdminTagOutput {
  return {
    id: row.id.toString(),
    name: row.name,
    productCount: row._count.product_tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
