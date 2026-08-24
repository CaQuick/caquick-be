import type { OrderStatus } from '@prisma/client';

/**
 * createOrder resolver 반환용 도메인 출력 타입.
 * SDL(order-checkout.graphql)의 CreateOrderOutput과 필드 일치.
 */
export interface CreateOrderOutput {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  pickupAt: Date;
  totalPrice: number;
}
