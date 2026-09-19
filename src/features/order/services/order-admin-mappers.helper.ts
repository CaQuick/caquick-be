import { anonymizeReviewAuthor } from '@/common/utils/review-author';
import type {
  AdminOrderDetailRow,
  AdminOrderRow,
} from '@/features/order/repositories/order.repository';
import {
  toOrderItemDetail,
  toOrderStatusHistory,
} from '@/features/order/services/order-output-mappers.helper';
import type {
  AdminOrderDetailOutput,
  AdminOrderSummaryOutput,
} from '@/features/order/types/order-admin-output.type';

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
    items: row.items.map(toOrderItemDetail),
    statusHistories: row.status_histories.map(toOrderStatusHistory),
  };
}
