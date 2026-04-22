import type { PrismaClient, SearchHistory } from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface SearchHistoryOverrides {
  account_id?: bigint;
  keyword?: string;
  last_used_at?: Date;
  deleted_at?: Date | null;
}

export async function createSearchHistory(
  prisma: PrismaClient,
  overrides: SearchHistoryOverrides = {},
): Promise<SearchHistory> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;

  return prisma.searchHistory.create({
    data: {
      account_id: accountId,
      keyword: overrides.keyword ?? `keyword_${seq}`,
      last_used_at: overrides.last_used_at ?? new Date(),
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
