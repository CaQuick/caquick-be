import type {
  Account,
  AccountStatus,
  AccountType,
  PrismaClient,
} from '@/generated/prisma/client';
import { nextSeq } from '@/test/factories/sequence';

export interface AccountOverrides {
  account_type?: AccountType;
  status?: AccountStatus;
  email?: string | null;
  name?: string | null;
  deleted_at?: Date | null;
  created_at?: Date;
}

export async function createAccount(
  prisma: PrismaClient,
  overrides: AccountOverrides = {},
): Promise<Account> {
  const seq = nextSeq();
  return prisma.account.create({
    data: {
      account_type: overrides.account_type ?? 'USER',
      status: overrides.status ?? 'ACTIVE',
      email:
        overrides.email === undefined
          ? `user${seq}@example.com`
          : overrides.email,
      name: overrides.name === undefined ? `User ${seq}` : overrides.name,
      deleted_at: overrides.deleted_at ?? null,
      ...(overrides.created_at ? { created_at: overrides.created_at } : {}),
    },
  });
}
