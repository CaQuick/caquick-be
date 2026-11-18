import {
  evaluateProductCustomIssues,
  threeDCategoryOf,
} from '@/features/product/services/product-custom-readiness.helper';
import type {
  SellerCustomReadinessOutput,
  SellerCustomTextTokenOutput,
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
  SellerProductImageOutput,
  SellerProductOutput,
} from '@/features/product/types/product-seller-output.type';
import { CustomMode, type CustomTextAlign } from '@/generated/prisma/client';

export interface ProductOptionItemRow {
  id: bigint;
  option_group_id: bigint;
  title: string;
  description: string | null;
  image_url: string | null;
  price_delta: number;
  sort_order: number;
  is_active: boolean;
  three_d_key: string | null;
}

export interface ProductOptionGroupRow {
  id: bigint;
  product_id: bigint;
  name: string;
  description: string | null;
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_active: boolean;
  option_items: ProductOptionItemRow[];
}

export interface ProductCustomTextTokenRow {
  id: bigint;
  template_id: bigint;
  token_key: string;
  label: string;
  default_text: string;
  max_length: number;
  sort_order: number;
  is_required: boolean;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  text_color: string;
  text_align: CustomTextAlign;
}

export interface ProductCustomTemplateRow {
  id: bigint;
  product_id: bigint;
  base_image_url: string;
  free_edit_enabled: boolean;
  revision: number;
  deleted_at: Date | null;
  text_tokens: ProductCustomTextTokenRow[];
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
  preparation_time_minutes: number;
  custom_mode: CustomMode;
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

export function toOptionItemOutput(
  item: ProductOptionItemRow,
): SellerOptionItemOutput {
  return {
    id: item.id.toString(),
    optionGroupId: item.option_group_id.toString(),
    title: item.title,
    description: item.description,
    imageUrl: item.image_url,
    priceDelta: item.price_delta,
    sortOrder: item.sort_order,
    isActive: item.is_active,
    threeDKey: item.three_d_key,
  };
}

export function toOptionGroupOutput(
  g: ProductOptionGroupRow,
): SellerOptionGroupOutput {
  return {
    id: g.id.toString(),
    productId: g.product_id.toString(),
    name: g.name,
    description: g.description,
    isRequired: g.is_required,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    sortOrder: g.sort_order,
    isActive: g.is_active,
    threeDCategory: threeDCategoryOf(g),
    optionItems: g.option_items.map(toOptionItemOutput),
  };
}

export function toCustomTextTokenOutput(
  token: ProductCustomTextTokenRow,
): SellerCustomTextTokenOutput {
  return {
    id: token.id.toString(),
    templateId: token.template_id.toString(),
    tokenKey: token.token_key,
    label: token.label,
    defaultText: token.default_text,
    maxLength: token.max_length,
    sortOrder: token.sort_order,
    isRequired: token.is_required,
    posX: token.pos_x,
    posY: token.pos_y,
    width: token.width,
    height: token.height,
    textColor: token.text_color,
    textAlign: token.text_align,
  };
}

export function toCustomTemplateOutput(t: ProductCustomTemplateRow) {
  return {
    id: t.id.toString(),
    productId: t.product_id.toString(),
    baseImageUrl: t.base_image_url,
    freeEditEnabled: t.free_edit_enabled,
    revision: t.revision,
    textTokens: t.text_tokens.map(toCustomTextTokenOutput),
  };
}

/** 판매자 커스텀 설정 화면이 방식별 카드에 준비 이슈를 띄운다. */
export function toCustomReadinessOutput(
  row: Pick<ProductDetailRow, 'custom_template' | 'option_groups'>,
): SellerCustomReadinessOutput[] {
  return Object.values(CustomMode).map((mode) => {
    const issues = evaluateProductCustomIssues(row, mode);
    return { mode, ready: issues.length === 0, issues };
  });
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
    preparationTimeMinutes: row.preparation_time_minutes,
    customMode: row.custom_mode,
    customReadiness: toCustomReadinessOutput(row),
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
