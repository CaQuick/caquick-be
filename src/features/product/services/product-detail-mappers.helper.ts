import { calcDiscountRate } from '@/common/utils/discount-rate';
import type { ProductDetailRow } from '@/features/product/repositories/product.repository';
import { threeDCategoryOf } from '@/features/product/services/product-custom-readiness.helper';
import type {
  ProductDetail,
  ProductDetailCustomTemplate,
} from '@/features/product/types/product-detail-output.type';
import { CustomMode } from '@/generated/prisma/client';

/** 슬롯형 상품만 템플릿을 연다 — 3D·없음은 바탕 위 문구 편집이 없다. */
function toCustomTemplate(
  row: ProductDetailRow,
): ProductDetailCustomTemplate | null {
  const template = row.custom_template;
  if (row.custom_mode !== CustomMode.SLOT || template?.deleted_at !== null) {
    return null;
  }
  return {
    revision: template.revision,
    baseImageUrl: template.base_image_url,
    freeEditEnabled: template.free_edit_enabled,
    slots: template.text_tokens.map((slot) => ({
      id: slot.id.toString(),
      label: slot.label,
      defaultText: slot.default_text,
      maxLength: slot.max_length,
      isRequired: slot.is_required,
      posX: slot.pos_x,
      posY: slot.pos_y,
      width: slot.width,
      height: slot.height,
      textColor: slot.text_color,
      textAlign: slot.text_align,
      sortOrder: slot.sort_order,
    })),
  };
}

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
      threeDCategory: threeDCategoryOf(group),
      items: group.option_items.map((item) => ({
        id: item.id.toString(),
        title: item.title,
        description: item.description,
        imageUrl: item.image_url,
        priceDelta: item.price_delta,
        sortOrder: item.sort_order,
        threeDKey: item.three_d_key,
      })),
    })),
    customMode: row.custom_mode,
    customTemplate: toCustomTemplate(row),
  };
}
