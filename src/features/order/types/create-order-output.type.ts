import type { OrderStatus } from '@/generated/prisma/client';

export interface CreateOrderOutput {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  pickupAt: Date;
  totalPrice: number;
}
