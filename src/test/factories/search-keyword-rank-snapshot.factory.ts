import type { PrismaClient } from '@/generated/prisma/client';

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
