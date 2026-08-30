import type { PrismaClient, SearchEvent } from '@prisma/client';

import { nextSeq } from '@/test/factories/sequence';

export interface SearchEventOverrides {
  account_id?: bigint | null;
  keyword?: string;
  created_at?: Date;
  deleted_at?: Date | null;
}

/** 검색 집계 이벤트. 기본은 비로그인(account_id null). */
export async function createSearchEvent(
  prisma: PrismaClient,
  overrides: SearchEventOverrides = {},
): Promise<SearchEvent> {
  const seq = nextSeq();
  return prisma.searchEvent.create({
    data: {
      account_id: overrides.account_id ?? null,
      keyword: overrides.keyword ?? `keyword_${seq}`,
      context: 'GLOBAL',
      created_at: overrides.created_at ?? new Date(),
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
