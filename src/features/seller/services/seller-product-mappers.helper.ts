import type {
  SellerProductImageOutput,
  SellerProductOutput,
} from '@/features/seller/types/seller-output.type';

/**
 * Product 분할 서비스들이 공유하는 매핑 헬퍼.
 *
 * 순수 함수 (this 의존 없음). DI 가 필요 없으므로 static export 만으로 충분.
 */

export interface ProductOptionGroupRow {
  id: bigint;
  product_id: bigint;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  option_requires_description: boolean;
  option_requires_image: boolean;
  sort_order: number;
  is_active: boolean;
  option_items: {
    id: bigint;
    option_group_id: bigint;
    title: string;
    description: string | null;
    image_url: string | null;
    price_delta: number;
    sort_order: number;
    is_active: boolean;
  }[];
}

export interface ProductCustomTemplateRow {
  id: bigint;
  product_id: bigint;
  base_image_url: string;
  is_active: boolean;
  text_tokens: {
    id: bigint;
    template_id: bigint;
    token_key: string;
    default_text: string;
    max_length: number;
    sort_order: number;
    is_required: boolean;
    pos_x: number | null;
    pos_y: number | null;
    width: number | null;
    height: number | null;
  }[];
}

export interface ProductDetailRow {
  id: bigint;
  store_id: bigint;
  name: string;
  description: string | null;
  purchase_notice: string | null;
  regular_price: number;
  sale_price: number | null;
  currency: string;
  base_design_image_url: string | null;
  preparation_time_minutes: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  images: { id: bigint; image_url: string; sort_order: number }[];
  product_categories: { category: { id: bigint; name: string } }[];
  product_tags: { tag: { id: bigint; name: string } }[];
  option_groups: ProductOptionGroupRow[];
  custom_template: ProductCustomTemplateRow | null;
}

export function toProductImageOutput(row: {
  id: bigint;
  image_url: string;
  sort_order: number;
}): SellerProductImageOutput {
  return {
    id: row.id.toString(),
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
  };
}

export function toOptionGroupOutput(g: ProductOptionGroupRow) {
  return {
    id: g.id.toString(),
    productId: g.product_id.toString(),
    name: g.name,
    isRequired: g.is_required,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    optionRequiresDescription: g.option_requires_description,
    optionRequiresImage: g.option_requires_image,
    sortOrder: g.sort_order,
    isActive: g.is_active,
    optionItems: g.option_items.map((item) => ({
      id: item.id.toString(),
      optionGroupId: item.option_group_id.toString(),
      title: item.title,
      description: item.description,
      imageUrl: item.image_url,
      priceDelta: item.price_delta,
      sortOrder: item.sort_order,
      isActive: item.is_active,
    })),
  };
}

export function toCustomTemplateOutput(t: ProductCustomTemplateRow) {
  return {
    id: t.id.toString(),
    productId: t.product_id.toString(),
    baseImageUrl: t.base_image_url,
    isActive: t.is_active,
    textTokens: t.text_tokens.map((token) => ({
      id: token.id.toString(),
      templateId: token.template_id.toString(),
      tokenKey: token.token_key,
      defaultText: token.default_text,
      maxLength: token.max_length,
      sortOrder: token.sort_order,
      isRequired: token.is_required,
      posX: token.pos_x,
      posY: token.pos_y,
      width: token.width,
      height: token.height,
    })),
  };
}

export function toProductOutput(row: ProductDetailRow): SellerProductOutput {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    name: row.name,
    description: row.description,
    purchaseNotice: row.purchase_notice,
    regularPrice: row.regular_price,
    salePrice: row.sale_price,
    currency: row.currency,
    baseDesignImageUrl: row.base_design_image_url,
    preparationTimeMinutes: row.preparation_time_minutes,
    isActive: row.is_active,
    images: row.images.map((image) => toProductImageOutput(image)),
    categories: row.product_categories.map((c) => ({
      id: c.category.id.toString(),
      name: c.category.name,
    })),
    tags: row.product_tags.map((t) => ({
      id: t.tag.id.toString(),
      name: t.tag.name,
    })),
    optionGroups: row.option_groups.map((g) => toOptionGroupOutput(g)),
    customTemplate: row.custom_template
      ? toCustomTemplateOutput(row.custom_template)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
