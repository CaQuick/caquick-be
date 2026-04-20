import type { PrismaClient, RecentProductView } from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { createProduct } from '@/test/factories/product.factory';

export interface RecentProductViewOverrides {
  account_id?: bigint;
  product_id?: bigint;
  viewed_at?: Date;
  deleted_at?: Date | null;
}

export async function createRecentProductView(
  prisma: PrismaClient,
  overrides: RecentProductViewOverrides = {},
): Promise<RecentProductView> {
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;
  const productId = overrides.product_id ?? (await createProduct(prisma)).id;

  return prisma.recentProductView.create({
    data: {
      account_id: accountId,
      product_id: productId,
      viewed_at: overrides.viewed_at ?? new Date(),
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
