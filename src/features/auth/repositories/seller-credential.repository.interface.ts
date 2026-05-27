import type { Prisma } from '@prisma/client';

/**
 * SellerCredential Repository 토큰 (Nest DI 주입용).
 */
export const SELLER_CREDENTIAL_REPOSITORY = Symbol(
  'SELLER_CREDENTIAL_REPOSITORY',
);

/**
 * 로그인/refresh/비밀번호 변경 흐름에서 사용하는 SellerCredential 페이로드.
 */
export type SellerCredentialWithAccount = Prisma.SellerCredentialGetPayload<{
  include: {
    seller_account: {
      select: {
        id: true;
        account_type: true;
        status: true;
        store: { select: { id: true } };
      };
    };
  };
}>;

/**
 * SellerCredential Repository 인터페이스.
 *
 * 판매자 자격정보(username/password_hash/last_login_at) 의 read/write 를 담당한다.
 */
export interface ISellerCredentialRepository {
  /**
   * username 기준 판매자 자격정보를 조회한다.
   */
  findSellerCredentialByUsername(
    username: string,
  ): Promise<SellerCredentialWithAccount | null>;

  /**
   * 계정 ID 기준 판매자 자격정보를 조회한다.
   */
  findSellerCredentialByAccountId(
    accountId: bigint,
  ): Promise<SellerCredentialWithAccount | null>;

  /**
   * 판매자 최근 로그인 시각을 갱신한다.
   */
  updateSellerLastLogin(sellerAccountId: bigint, now: Date): Promise<void>;

  /**
   * 판매자 비밀번호 해시를 갱신한다.
   */
  updateSellerPasswordHash(args: {
    sellerAccountId: bigint;
    passwordHash: string;
    now: Date;
  }): Promise<void>;
}
