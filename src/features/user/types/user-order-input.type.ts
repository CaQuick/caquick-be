import type { OrderStatus } from '@prisma/client';

export interface MyOrdersInput {
  statuses?: OrderStatus[];
  offset?: number;
  limit?: number;
}
