import { isCustomOrderItem } from '@/features/order/services/order-output-mappers.helper';
import type {
  SellerOrderUpdateEvent,
  SellerOrderUpdateKind,
} from '@/features/order/types/order-seller-output.type';
import {
  OrderStatus,
  type Order,
  type OrderItem,
} from '@/generated/prisma/client';

export type SellerOrderUpdateRow = Pick<
  Order,
  | 'id'
  | 'order_number'
  | 'status'
  | 'pickup_at'
  | 'buyer_name'
  | 'total_price'
  | 'confirm_deadline_at'
  | 'updated_at'
> & {
  /** 첫 품목이 상품명·커스텀 여부를 정한다 */
  items: Pick<OrderItem, 'product_name_snapshot' | 'custom_mode_snapshot'>[];
};

export function toSellerOrderUpdateEvent(
  kind: SellerOrderUpdateKind,
  row: SellerOrderUpdateRow,
): SellerOrderUpdateEvent {
  const [firstItem] = row.items;
  return {
    kind,
    orderId: row.id.toString(),
    orderNumber: row.order_number,
    status: row.status,
    pickupAt: row.pickup_at.toISOString(),
    buyerName: row.buyer_name,
    totalPrice: row.total_price,
    productName: firstItem?.product_name_snapshot ?? '',
    hasCustom: isCustomOrderItem(firstItem),
    // 확정·취소 뒤에도 행에 값이 남으므로 접수 상태일 때만 낸다
    confirmDeadlineAt:
      row.status === OrderStatus.SUBMITTED && row.confirm_deadline_at
        ? row.confirm_deadline_at.toISOString()
        : null,
    updatedAt: row.updated_at.toISOString(),
  };
}
