/**
 * 검색 집계 이벤트 + 인기 검색어 스냅샷 시드(검색 진입 화면 검증용).
 *
 * - 이벤트는 시드 유저 소유(account_id)로만 만들어 resetSeedScope가 유저 기준으로 정리한다.
 * - 스냅샷은 이벤트에서 파생되는 캐시라 시드마다 전량 재생성한다(직전 정각 + 현재 정각 2개,
 *   순위 변동 UP/DOWN/SAME/NEW가 모두 보이도록 구성).
 */
import type { PrismaClient } from '@prisma/client';

import type { SeededUser } from './users';

const HOUR_MS = 60 * 60 * 1000;

const PREVIOUS_RANKING = [
  '과일 케이크',
  '생일 케이크',
  '크리스마스',
  '3d',
  '강아지 케이크',
  '생화 케이크',
  '떡 케이크',
  '연인',
  '미니 케이크',
  '기념일 케이크',
  '레터링 케이크',
] as const;

/** 현재 정각 기준 순위(검색 횟수 desc). 직전 대비 UP/DOWN/SAME/NEW 혼합. */
const CURRENT_RANKING: { keyword: string; count: number }[] = [
  { keyword: '생일 케이크', count: 12 }, // 2 → 1 UP
  { keyword: '과일 케이크', count: 11 }, // 1 → 2 DOWN
  { keyword: '크리스마스', count: 9 }, // SAME
  { keyword: '3d', count: 8 }, // SAME
  { keyword: '강아지 케이크', count: 7 }, // SAME
  { keyword: '생화 케이크', count: 6 }, // SAME
  { keyword: '떡 케이크', count: 5 }, // SAME
  { keyword: '연인', count: 4 }, // SAME
  { keyword: '미니 케이크', count: 3 }, // SAME
  { keyword: '도넛', count: 2 }, // NEW
  { keyword: '기념일 케이크', count: 1 }, // 10 → 11 DOWN
];

export async function seedSearchEvents(
  prisma: PrismaClient,
  ctx: { users: SeededUser[] },
): Promise<void> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedSearchEvents');

  const now = Date.now();
  const rankedAt = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
  const previousAt = new Date(rankedAt.getTime() - HOUR_MS);

  // 현재 정각 스냅샷 윈도우([rankedAt-24h, rankedAt)) 안에 count만큼 이벤트를 심는다
  await prisma.searchEvent.createMany({
    data: CURRENT_RANKING.flatMap(({ keyword, count }) =>
      Array.from({ length: count }, (_, i) => ({
        account_id: user1.id,
        keyword,
        context: 'GLOBAL' as const,
        created_at: new Date(rankedAt.getTime() - (i + 1) * 10 * 60 * 1000),
      })),
    ),
  });

  await prisma.searchKeywordRankSnapshot.deleteMany();
  await prisma.searchKeywordRankSnapshot.createMany({
    data: [
      ...PREVIOUS_RANKING.map((keyword, i) => ({
        ranked_at: previousAt,
        rank: i + 1,
        keyword,
        search_count: PREVIOUS_RANKING.length - i,
      })),
      ...CURRENT_RANKING.map(({ keyword, count }, i) => ({
        ranked_at: rankedAt,
        rank: i + 1,
        keyword,
        search_count: count,
      })),
    ],
  });
}
