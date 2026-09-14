import type { Prisma } from '@/generated/prisma/client';

/**
 * AccountCredential Repository 토큰 (Nest DI 주입용).
 */
export const ACCOUNT_CREDENTIAL_REPOSITORY = Symbol(
  'ACCOUNT_CREDENTIAL_REPOSITORY',
);

/**
 * 로그인/refresh/비밀번호 변경 흐름에서 사용하는 AccountCredential 페이로드.
 */
export type AccountCredentialWithAccount = Prisma.AccountCredentialGetPayload<{
  include: {
    account: {
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
 * AccountCredential Repository 인터페이스.
 *
 * username/password 자격증명(SELLER·ADMIN 공용)의 read/write 를 담당한다.
 */
export interface IAccountCredentialRepository {
  /**
   * username 기준 자격증명을 조회한다.
   */
  findCredentialByUsername(
    username: string,
  ): Promise<AccountCredentialWithAccount | null>;

  /**
   * 계정 ID 기준 자격증명을 조회한다.
   */
  findCredentialByAccountId(
    accountId: bigint,
  ): Promise<AccountCredentialWithAccount | null>;

  /**
   * 최근 로그인 시각을 갱신한다.
   */
  updateLastLogin(accountId: bigint, now: Date): Promise<void>;

  /**
   * 비밀번호 해시를 갱신한다. 본인이 바꾼 것이므로 must_change_password 를 해제한다.
   */
  updatePasswordHash(args: {
    accountId: bigint;
    passwordHash: string;
    now: Date;
  }): Promise<void>;
}
