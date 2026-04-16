import type {
  Order,
  OrderItem,
  OrderStatus,
  PrismaClient,
} from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { createProduct } from '@/test/factories/product.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface OrderOverrides {
  account_id?: bigint;
  order_number?: string;
  status?: OrderStatus;
  pickup_at?: Date;
  buyer_name?: string;
  buyer_phone?: string;
  subtotal_price?: number;
  discount_price?: number;
  total_price?: number;
}

export async function createOrder(
  prisma: PrismaClient,
  overrides: OrderOverrides = {},
): Promise<Order> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;

  return prisma.order.create({
    data: {
      account_id: accountId,
      order_number: overrides.order_number ?? `ORD-${Date.now()}-${seq}`,
      status: overrides.status ?? 'SUBMITTED',
      pickup_at:
        overrides.pickup_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      buyer_name: overrides.buyer_name ?? `Buyer ${seq}`,
      buyer_phone: overrides.buyer_phone ?? '010-0000-0000',
      subtotal_price: overrides.subtotal_price ?? 10000,
      discount_price: overrides.discount_price ?? 0,
      total_price: overrides.total_price ?? 10000,
    },
  });
}

export interface OrderItemOverrides {
  order_id?: bigint;
  store_id?: bigint;
  product_id?: bigint;
  product_name_snapshot?: string;
  regular_price_snapshot?: number;
  sale_price_snapshot?: number | null;
  quantity?: number;
  item_subtotal_price?: number;
}

export async function createOrderItem(
  prisma: PrismaClient,
  overrides: OrderItemOverrides = {},
): Promise<OrderItem> {
  const product =
    overrides.product_id && overrides.store_id
      ? null
      : await createProduct(prisma);

  const productId = overrides.product_id ?? product!.id;
  const storeId = overrides.store_id ?? product!.store_id;

  const order = overrides.order_id ? null : await createOrder(prisma);
  const orderId = overrides.order_id ?? order!.id;

  return prisma.orderItem.create({
    data: {
      order_id: orderId,
      store_id: storeId,
      product_id: productId,
      product_name_snapshot:
        overrides.product_name_snapshot ?? 'Product snapshot',
      regular_price_snapshot: overrides.regular_price_snapshot ?? 10000,
      sale_price_snapshot: overrides.sale_price_snapshot ?? null,
      quantity: overrides.quantity ?? 1,
      item_subtotal_price: overrides.item_subtotal_price ?? 10000,
    },
  });
}
