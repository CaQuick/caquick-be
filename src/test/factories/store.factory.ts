import type { PrismaClient, Store } from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface StoreOverrides {
  seller_account_id?: bigint;
  store_name?: string;
  store_phone?: string;
  address_full?: string;
  address_city?: string | null;
  address_district?: string | null;
  address_neighborhood?: string | null;
  is_active?: boolean;
}

export async function createStore(
  prisma: PrismaClient,
  overrides: StoreOverrides = {},
): Promise<Store> {
  const seq = nextSeq();
  const sellerAccountId =
    overrides.seller_account_id ??
    (await createAccount(prisma, { account_type: 'SELLER' })).id;

  return prisma.store.create({
    data: {
      seller_account_id: sellerAccountId,
      store_name: overrides.store_name ?? `Store ${seq}`,
      store_phone:
        overrides.store_phone ?? `010-0000-${String(seq).padStart(4, '0')}`,
      address_full: overrides.address_full ?? `서울시 테스트구 테스트동 ${seq}`,
      address_city: overrides.address_city ?? '서울시',
      address_district: overrides.address_district ?? '테스트구',
      address_neighborhood: overrides.address_neighborhood ?? '테스트동',
      is_active: overrides.is_active ?? true,
    },
  });
}
