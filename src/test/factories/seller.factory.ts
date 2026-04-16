import type {
  PrismaClient,
  SellerCredential,
  SellerProfile,
} from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';

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
