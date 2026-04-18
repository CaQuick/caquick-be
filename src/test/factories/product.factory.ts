import type { PrismaClient, Product } from '@prisma/client';

import { nextSeq } from '@/test/factories/sequence';
import { createStore } from '@/test/factories/store.factory';

export interface ProductOverrides {
  store_id?: bigint;
  name?: string;
  description?: string | null;
  regular_price?: number;
  sale_price?: number | null;
  is_active?: boolean;
}

export async function createProduct(
  prisma: PrismaClient,
  overrides: ProductOverrides = {},
): Promise<Product> {
  const seq = nextSeq();
  const storeId = overrides.store_id ?? (await createStore(prisma)).id;

  return prisma.product.create({
    data: {
      store_id: storeId,
      name: overrides.name ?? `Product ${seq}`,
      description: overrides.description ?? null,
      regular_price: overrides.regular_price ?? 10000,
      sale_price: overrides.sale_price ?? null,
      is_active: overrides.is_active ?? true,
    },
  });
}
