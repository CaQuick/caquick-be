import type { PrismaClient, StoreWishlistItem } from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { createStore } from '@/test/factories/store.factory';

export interface StoreWishlistOverrides {
  account_id?: bigint;
  store_id?: bigint;
  deleted_at?: Date | null;
}

export async function createStoreWishlist(
  prisma: PrismaClient,
  overrides: StoreWishlistOverrides = {},
): Promise<StoreWishlistItem> {
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;
  const storeId = overrides.store_id ?? (await createStore(prisma)).id;

  return prisma.storeWishlistItem.create({
    data: {
      account_id: accountId,
      store_id: storeId,
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
