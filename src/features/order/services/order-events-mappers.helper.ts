import type { SellerOrderUpdateEvent } from '@/features/order/types/order-seller-output.type';
import type { Order } from '@/generated/prisma/client';

export type SellerOrderUpdateRow = Pick<
  Order,
  | 'id'
  | 'order_number'
  | 'status'
  | 'pickup_at'
  | 'buyer_name'
  | 'total_price'
  | 'updated_at'
>;

export function toSellerOrderUpdateEvent(
  row: SellerOrderUpdateRow,
  productName: string,
): SellerOrderUpdateEvent {
  return {
    orderId: row.id.toString(),
    orderNumber: row.order_number,
    status: row.status,
    pickupAt: row.pickup_at.toISOString(),
    buyerName: row.buyer_name,
    totalPrice: row.total_price,
    productName,
    updatedAt: row.updated_at.toISOString(),
  };
}
