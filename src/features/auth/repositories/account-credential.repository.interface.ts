import type { Prisma } from '@/generated/prisma/client';

export const ACCOUNT_CREDENTIAL_REPOSITORY = Symbol(
  'ACCOUNT_CREDENTIAL_REPOSITORY',
);

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

export interface IAccountCredentialRepository {
  findCredentialByUsername(
    username: string,
  ): Promise<AccountCredentialWithAccount | null>;

  findCredentialByAccountId(
    accountId: bigint,
  ): Promise<AccountCredentialWithAccount | null>;

  updateLastLogin(accountId: bigint, now: Date): Promise<void>;

  /** 본인이 바꾼 것이므로 must_change_password를 해제한다. */
  updatePasswordHash(args: {
    accountId: bigint;
    passwordHash: string;
    now: Date;
  }): Promise<void>;
}
