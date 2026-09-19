import type { IdentityProvider, Prisma } from '@/generated/prisma/client';

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

export type AccountWithProfile = Prisma.AccountGetPayload<{
  include: { user_profile: true };
}>;

export type AccountForJwt = Prisma.AccountGetPayload<{
  select: {
    id: true;
    status: true;
    account_type: true;
    credential: { select: { must_change_password: true } };
    store: { select: { id: true } };
  };
}>;

export type AccountIdentityWithAccount = Prisma.AccountIdentityGetPayload<{
  include: {
    account: {
      include: { user_profile: true };
    };
  };
}>;

export interface IAccountRepository {
  findIdentityByProviderSubject(
    provider: IdentityProvider,
    providerSubject: string,
  ): Promise<AccountIdentityWithAccount | null>;

  findAccountByEmail(email: string): Promise<AccountWithProfile | null>;

  /**
   * (provider, subject)로만 식별한다 — 이메일로 기존 계정에 붙이지 않는다(provider 간 계정 통합 없음).
   * 연동된 계정이 탈퇴 상태면 복구하지 않고 재가입(새 계정)으로 처리한다.
   */
  upsertUserByOidcIdentity(args: {
    provider: IdentityProvider;
    providerSubject: string;
    providerEmail?: string;
    emailVerified: boolean;
    providerDisplayName?: string;
    providerProfileImageUrl?: string;
  }): Promise<{ account: AccountWithProfile | null }>;

  findAccountForJwt(accountId: bigint): Promise<AccountForJwt | null>;
}
