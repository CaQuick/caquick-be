import type { IdentityProvider, Prisma } from '@prisma/client';

/**
 * Account Repository 토큰 (Nest DI 주입용).
 */
export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

/**
 * include: { user_profile: true } 를 가진 Account.
 */
export type AccountWithProfile = Prisma.AccountGetPayload<{
  include: { user_profile: true };
}>;

/**
 * JWT 검증용 좁은 select.
 */
export type AccountForJwt = Prisma.AccountGetPayload<{
  select: { id: true; status: true; account_type: true };
}>;

/**
 * include: { account: { include: { user_profile: true } } } 를 가진 AccountIdentity.
 */
export type AccountIdentityWithAccount = Prisma.AccountIdentityGetPayload<{
  include: {
    account: {
      include: { user_profile: true };
    };
  };
}>;

/**
 * Account / AccountIdentity / UserProfile Repository 인터페이스.
 *
 * OIDC upsert 와 JWT/Me 조회 등 계정 라이프사이클 read/write 를 담당한다.
 */
export interface IAccountRepository {
  /**
   * provider + subject 로 AccountIdentity 를 조회한다(soft-delete 제외).
   */
  findIdentityByProviderSubject(
    provider: IdentityProvider,
    providerSubject: string,
  ): Promise<AccountIdentityWithAccount | null>;

  /**
   * 이메일(verified 전제) 로 기존 계정을 찾는다(soft-delete 제외).
   */
  findAccountByEmail(email: string): Promise<AccountWithProfile | null>;

  /**
   * Identity 가 없을 때 계정을 만들거나(또는 이메일로 기존 계정에 붙여서) Identity 를 upsert 한다.
   *
   * 정책:
   * - (provider, subject) 로 우선 식별
   * - 없으면 신규 계정 생성
   */
  upsertUserByOidcIdentity(args: {
    provider: IdentityProvider;
    providerSubject: string;
    providerEmail?: string;
    emailVerified: boolean;
    providerDisplayName?: string;
    providerProfileImageUrl?: string;
  }): Promise<{ account: AccountWithProfile | null }>;

  /**
   * access token 검증용으로 계정을 조회한다.
   */
  findAccountForJwt(accountId: bigint): Promise<AccountForJwt | null>;

  /**
   * accountId 기준으로 유저를 조회한다(soft-delete 제외).
   */
  findAccountForMe(accountId: bigint): Promise<AccountWithProfile | null>;
}
