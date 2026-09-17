import { anonymizeReviewAuthor } from '@/common/utils/review-author';
import type {
  AdminOrderDetailOutput,
  AdminOrderItemDetailOutput,
  AdminOrderSummaryOutput,
} from '@/features/admin/types/admin-output.type';
import type { AdminOrderDetailRow, AdminOrderRow } from '@/features/order';

/** 순수 매퍼(DI 없음). 판매자 주문 매퍼와 같은 스냅샷 규칙. */
export function toAdminOrderSummaryOutput(
  row: AdminOrderRow,
): AdminOrderSummaryOutput {
  return {
    id: row.id.toString(),
    orderNumber: row.order_number,
    accountId: row.account_id.toString(),
    // 주문은 단일 매장 구조 — 첫 품목이 매장을 정한다(다상품 확장 시 재검토)
    storeId: row.items[0]?.store_id.toString() ?? null,
    status: row.status,
    pickupAt: row.pickup_at,
    buyerName: row.buyer_name,
    buyerPhone: row.buyer_phone,
    totalPrice: row.total_price,
    createdAt: row.created_at,
  };
}

export function toAdminOrderDetailOutput(
  row: AdminOrderDetailRow,
): AdminOrderDetailOutput {
  const profile = row.account.user_profile;
  return {
    id: row.id.toString(),
    orderNumber: row.order_number,
    buyer: {
      accountId: row.account.id.toString(),
      email: row.account.email,
      // 구매자도 리뷰 작성자와 같은 탈퇴 노출 정책을 따른다
      nickname: anonymizeReviewAuthor(profile).nickname,
      status: row.account.status,
    },
    status: row.status,
    pickupAt: row.pickup_at,
    buyerName: row.buyer_name,
    buyerPhone: row.buyer_phone,
    subtotalPrice: row.subtotal_price,
    discountPrice: row.discount_price,
    totalPrice: row.total_price,
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    madeAt: row.made_at,
    pickedUpAt: row.picked_up_at,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: row.items.map(toItem),
    statusHistories: row.status_histories.map((h) => ({
      id: h.id.toString(),
      fromStatus: h.from_status,
      toStatus: h.to_status,
      changedAt: h.changed_at,
      note: h.note,
    })),
  };
}

function toItem(
  item: AdminOrderDetailRow['items'][number],
): AdminOrderItemDetailOutput {
  return {
    id: item.id.toString(),
    storeId: item.store_id.toString(),
    productId: item.product_id.toString(),
    productNameSnapshot: item.product_name_snapshot,
    regularPriceSnapshot: item.regular_price_snapshot,
    salePriceSnapshot: item.sale_price_snapshot,
    quantity: item.quantity,
    itemSubtotalPrice: item.item_subtotal_price,
    optionItems: item.option_items.map((opt) => ({
      id: opt.id.toString(),
      groupNameSnapshot: opt.group_name_snapshot,
      optionTitleSnapshot: opt.option_title_snapshot,
      optionPriceDeltaSnapshot: opt.option_price_delta_snapshot,
    })),
    customTexts: item.custom_texts.map((text) => ({
      id: text.id.toString(),
      tokenKeySnapshot: text.token_key_snapshot,
      defaultTextSnapshot: text.default_text_snapshot,
      valueText: text.value_text,
      sortOrder: text.sort_order,
    })),
    freeEdits: item.free_edits.map((edit) => ({
      id: edit.id.toString(),
      cropImageUrl: edit.crop_image_url,
      descriptionText: edit.description_text,
      sortOrder: edit.sort_order,
      attachments: edit.attachments.map((a) => ({
        id: a.id.toString(),
        imageUrl: a.image_url,
        sortOrder: a.sort_order,
      })),
    })),
  };
}
