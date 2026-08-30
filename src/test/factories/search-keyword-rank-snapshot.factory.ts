import type { PrismaClient } from '@prisma/client';

/** 한 정각(ranked_at)의 스냅샷 행들을 순서대로 rank 1..N으로 만든다. */
export async function createKeywordRankSnapshot(
  prisma: PrismaClient,
  args: { ranked_at: Date; keywords: { keyword: string; count?: number }[] },
): Promise<void> {
  await prisma.searchKeywordRankSnapshot.createMany({
    data: args.keywords.map((k, i) => ({
      ranked_at: args.ranked_at,
      rank: i + 1,
      keyword: k.keyword,
      search_count: k.count ?? 1,
    })),
  });
}
