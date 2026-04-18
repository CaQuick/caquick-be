import type {
  AccountIdentity,
  AuthRefreshSession,
  IdentityProvider,
  PrismaClient,
} from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface AccountIdentityOverrides {
  account_id?: bigint;
  provider?: IdentityProvider;
  provider_subject?: string;
  provider_email?: string | null;
  provider_display_name?: string | null;
  provider_profile_image_url?: string | null;
}

export async function createAccountIdentity(
  prisma: PrismaClient,
  overrides: AccountIdentityOverrides = {},
): Promise<AccountIdentity> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;

  return prisma.accountIdentity.create({
    data: {
      account_id: accountId,
      provider: overrides.provider ?? 'GOOGLE',
      provider_subject: overrides.provider_subject ?? `sub_${seq}`,
      provider_email: overrides.provider_email ?? `oidc${seq}@example.com`,
      provider_display_name:
        overrides.provider_display_name ?? `OIDC User ${seq}`,
      provider_profile_image_url: overrides.provider_profile_image_url ?? null,
    },
  });
}

export interface RefreshSessionOverrides {
  account_id?: bigint;
  token_hash?: string;
  user_agent?: string | null;
  ip_address?: string | null;
  expires_at?: Date;
  revoked_at?: Date | null;
}

export async function createRefreshSession(
  prisma: PrismaClient,
  overrides: RefreshSessionOverrides = {},
): Promise<AuthRefreshSession> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;

  return prisma.authRefreshSession.create({
    data: {
      account_id: accountId,
      token_hash:
        overrides.token_hash ??
        `hash_${seq}_${'a'.repeat(64 - `hash_${seq}_`.length)}`,
      user_agent: overrides.user_agent ?? 'test-agent',
      ip_address: overrides.ip_address ?? '127.0.0.1',
      expires_at:
        overrides.expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: overrides.revoked_at ?? null,
    },
  });
}
