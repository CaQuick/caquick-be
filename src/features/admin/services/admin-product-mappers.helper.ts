import type {
  AdminProductDetailRow,
  AdminProductRow,
} from '@/features/admin/repositories/admin.repository';
import type {
  AdminProductDetailOutput,
  AdminProductOutput,
} from '@/features/admin/types/admin-output.type';

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
  };
}
