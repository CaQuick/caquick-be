import type {
  Account,
  PrismaClient,
  SellerCredential,
  SellerProfile,
  Store,
} from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';
import { createStore } from '@/test/factories/store.factory';

export interface SellerProfileOverrides {
  account_id?: bigint;
  business_name?: string;
  business_phone?: string;
}

export async function createSellerProfile(
  prisma: PrismaClient,
  overrides: SellerProfileOverrides = {},
): Promise<SellerProfile> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'SELLER' })).id;

  return prisma.sellerProfile.create({
    data: {
      account_id: accountId,
      business_name: overrides.business_name ?? `Business ${seq}`,
      business_phone:
        overrides.business_phone ?? `02-0000-${String(seq).padStart(4, '0')}`,
    },
  });
}

export interface SellerCredentialOverrides {
  seller_account_id?: bigint;
  username?: string;
  password_hash?: string;
}

export async function createSellerCredential(
  prisma: PrismaClient,
  overrides: SellerCredentialOverrides = {},
): Promise<SellerCredential> {
  const seq = nextSeq();
  const sellerAccountId =
    overrides.seller_account_id ??
    (await createAccount(prisma, { account_type: 'SELLER' })).id;

  return prisma.sellerCredential.create({
    data: {
      seller_account_id: sellerAccountId,
      username: overrides.username ?? `seller_${seq}`,
      password_hash:
        overrides.password_hash ??
        '$argon2id$v=19$m=65536,t=3,p=4$mock_salt$mock_hash',
    },
  });
}

/**
 * SELLER 계정 + Store + SellerProfile 한 세트를 생성한다.
 * seller-* 서비스 테스트는 모두 SellerContext가 필요하므로 매번 같은 셋업을 반복하지 않도록 helper 제공.
 */
export interface SellerContextSetup {
  account: Account;
  store: Store;
  profile: SellerProfile;
}

export async function setupSellerWithStore(
  prisma: PrismaClient,
  overrides: { storeName?: string } = {},
): Promise<SellerContextSetup> {
  const account = await createAccount(prisma, { account_type: 'SELLER' });
  const profile = await createSellerProfile(prisma, { account_id: account.id });
  const store = await createStore(prisma, {
    seller_account_id: account.id,
    store_name: overrides.storeName,
  });
  return { account, store, profile };
}
