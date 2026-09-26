import { DAY_MS } from '@/common/utils/kst-time';
import type {
  AccountCredential,
  AccountIdentity,
  AccountType,
  AuthRefreshSession,
  IdentityProvider,
  PrismaClient,
} from '@/generated/prisma/client';
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
      expires_at: overrides.expires_at ?? new Date(Date.now() + 7 * DAY_MS),
      revoked_at: overrides.revoked_at ?? null,
    },
  });
}

export interface AccountCredentialOverrides {
  account_id?: bigint;
  /** account_id 미지정 시 만들 계정 타입. 기본 SELLER. */
  account_type?: AccountType;
  username?: string;
  password_hash?: string;
  must_change_password?: boolean;
}

export async function createAccountCredential(
  prisma: PrismaClient,
  overrides: AccountCredentialOverrides = {},
): Promise<AccountCredential> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (
      await createAccount(prisma, {
        account_type: overrides.account_type ?? 'SELLER',
      })
    ).id;

  return prisma.accountCredential.create({
    data: {
      account_id: accountId,
      username: overrides.username ?? `credential_${seq}`,
      password_hash:
        overrides.password_hash ??
        '$argon2id$v=19$m=65536,t=3,p=4$mock_salt$mock_hash',
      must_change_password: overrides.must_change_password ?? false,
    },
  });
}
