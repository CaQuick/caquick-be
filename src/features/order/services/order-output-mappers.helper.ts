import type {
  OrderItemDetailOutput,
  OrderItemFreeEditOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
import type { OrderStatus } from '@/generated/prisma/client';

/** 매퍼 입력 row(주문 시점 스냅샷). 판매자·관리자·구매자 조회 row가 모두 만족하는 부분집합. */
export interface OrderItemFreeEditRow {
  id: bigint;
  crop_image_url: string;
  description_text: string;
  sort_order: number;
  attachments: { id: bigint; image_url: string; sort_order: number }[];
}

export interface OrderItemDetailRow {
  id: bigint;
  store_id: bigint;
  product_id: bigint;
  product_name_snapshot: string;
  regular_price_snapshot: number;
  sale_price_snapshot: number | null;
  quantity: number;
  item_subtotal_price: number;
  option_items: {
    id: bigint;
    group_name_snapshot: string;
    option_title_snapshot: string;
    option_price_delta_snapshot: number;
  }[];
  custom_texts: {
    id: bigint;
    token_key_snapshot: string;
    default_text_snapshot: string;
    value_text: string;
    sort_order: number;
  }[];
  free_edits: OrderItemFreeEditRow[];
}

export interface OrderStatusHistoryRow {
  id: bigint;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_at: Date;
  note: string | null;
}

/** 주문 품목 1벌(D31). 판매자·관리자·구매자 주문 상세가 같은 매퍼를 쓴다. */
export function toOrderItemDetail(
  item: OrderItemDetailRow,
): OrderItemDetailOutput {
  return {
    id: item.id.toString(),
    storeId: item.store_id.toString(),
    productId: item.product_id.toString(),
    productName: item.product_name_snapshot,
    regularPrice: item.regular_price_snapshot,
    salePrice: item.sale_price_snapshot,
    quantity: item.quantity,
    itemSubtotalPrice: item.item_subtotal_price,
    optionItems: item.option_items.map((opt) => ({
      id: opt.id.toString(),
      groupName: opt.group_name_snapshot,
      optionTitle: opt.option_title_snapshot,
      priceDelta: opt.option_price_delta_snapshot,
    })),
    customTexts: item.custom_texts.map((text) => ({
      id: text.id.toString(),
      tokenKey: text.token_key_snapshot,
      defaultText: text.default_text_snapshot,
      valueText: text.value_text,
      sortOrder: text.sort_order,
    })),
    freeEdits: item.free_edits.map(toOrderItemFreeEdit),
  };
}

export function toOrderItemFreeEdit(
  edit: OrderItemFreeEditRow,
): OrderItemFreeEditOutput {
  return {
    id: edit.id.toString(),
    cropImageUrl: edit.crop_image_url,
    descriptionText: edit.description_text,
    sortOrder: edit.sort_order,
    attachments: edit.attachments.map((a) => ({
      id: a.id.toString(),
      imageUrl: a.image_url,
      sortOrder: a.sort_order,
    })),
  };
}

export function toOrderStatusHistory(
  history: OrderStatusHistoryRow,
): OrderStatusHistoryOutput {
  return {
    id: history.id.toString(),
    fromStatus: history.from_status,
    toStatus: history.to_status,
    changedAt: history.changed_at,
    note: history.note,
  };
}
