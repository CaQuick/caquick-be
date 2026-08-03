import type { ProductDetailRow } from '@/features/product/repositories/product.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type { ProductDetail } from '@/features/product/types/product-detail-output.type';

export function toProductDetail(
  row: ProductDetailRow,
  reviewCount: number,
  isWishlisted: boolean,
): ProductDetail {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    name: row.name,
    description: row.description,
    purchaseNotice: row.purchase_notice,
    images: row.images.map((image) => image.image_url),
    regularPrice: row.regular_price,
    salePrice: row.sale_price,
    discountRate: calcDiscountRate(row.regular_price, row.sale_price),
    currency: row.currency,
    reviewCount,
    isWishlisted,
    optionGroups: row.option_groups.map((group) => ({
      id: group.id.toString(),
      name: group.name,
      description: group.description,
      isRequired: group.is_required,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      sortOrder: group.sort_order,
      items: group.option_items.map((item) => ({
        id: item.id.toString(),
        title: item.title,
        description: item.description,
        imageUrl: item.image_url,
        priceDelta: item.price_delta,
        sortOrder: item.sort_order,
      })),
    })),
  };
}
