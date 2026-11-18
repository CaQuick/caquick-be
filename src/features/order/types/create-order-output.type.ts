import type { OrderPaymentOutput } from '@/features/order/types/order-payment-output.type';
import type { OrderStatus } from '@/generated/prisma/client';

export interface CreateOrderOutput {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  pickupAt: Date;
  totalPrice: number;
  payment: OrderPaymentOutput | null;
}
