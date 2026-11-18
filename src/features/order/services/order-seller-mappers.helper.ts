import type { SellerOrderRow } from '@/features/order/repositories/order.repository';
import {
  toOrderAutoTransitionTimes,
  toOrderListCustomBadge,
} from '@/features/order/services/order-output-mappers.helper';
import type { SellerOrderSummaryOutput } from '@/features/order/types/order-seller-output.type';

export function toSellerOrderSummaryOutput(
  row: SellerOrderRow,
): SellerOrderSummaryOutput {
  return {
    id: row.id.toString(),
    orderNumber: row.order_number,
    status: row.status,
    pickupAt: row.pickup_at,
    buyerName: row.buyer_name,
    buyerPhone: row.buyer_phone,
    totalPrice: row.total_price,
    createdAt: row.created_at,
    // 내 매장 첫 품목의 주문 시점 스냅샷 — 상품이 바뀌어도 카드 값은 유지된다
    firstItemName: row.items[0]?.product_name_snapshot ?? null,
    firstItemImageUrl: row.items[0]?.product_thumbnail_url_snapshot ?? null,
    ...toOrderListCustomBadge(row.items[0]),
    confirmDeadlineAt: toOrderAutoTransitionTimes(row).confirmDeadlineAt,
  };
}
