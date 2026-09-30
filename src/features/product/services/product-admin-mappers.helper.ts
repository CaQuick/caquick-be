import type {
  AdminProductDetailRow,
  AdminProductRow,
} from '@/features/product/repositories/product-admin.repository';
import {
  toCustomTemplateOutput,
  toOptionGroupOutput,
} from '@/features/product/services/product-seller-mappers.helper';
import type {
  AdminProductDetailOutput,
  AdminProductOutput,
} from '@/features/product/types/product-admin-output.type';

export function toAdminProductOutput(row: AdminProductRow): AdminProductOutput {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    storeName: row.store.store_name,
    name: row.name,
    regularPrice: row.regular_price,
    salePrice: row.sale_price,
    currency: row.currency,
    baseDesignImageUrl: row.base_design_image_url,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAdminProductDetailOutput(
  row: AdminProductDetailRow,
): AdminProductDetailOutput {
  return {
    product: toAdminProductOutput(row),
    storeIsActive: row.store.is_active,
    description: row.description,
    purchaseNotice: row.purchase_notice,
    preparationTimeMinutes: row.preparation_time_minutes,
    // nested relation은 soft-delete 자동 필터 밖 — 삭제된 이미지는 제외
    imageUrls: row.images
      .filter((i) => i.deleted_at === null)
      .map((i) => i.image_url),
    reviewCount: row._count.reviews,
    orderItemCount: row._count.order_items,
    categories: row.product_categories.map(({ category }) => ({
      id: category.id.toString(),
      categoryType: category.category_type,
      name: category.name,
      isActive: category.is_active,
    })),
    tags: row.product_tags.map(({ tag }) => ({
      id: tag.id.toString(),
      name: tag.name,
    })),
    optionGroups: row.option_groups.map((g) => toOptionGroupOutput(g)),
    customTemplate:
      row.custom_template && row.custom_template.deleted_at === null
        ? toCustomTemplateOutput(row.custom_template)
        : null,
  };
}
