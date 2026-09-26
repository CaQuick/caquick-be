import { Injectable } from '@nestjs/common';

import { KEYWORD_RANK_SNAPSHOT_SIZE } from '@/features/search/constants/search.constants';
import { Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export interface KeywordCountRow {
  keyword: string;
  count: number;
}

export interface KeywordRankSnapshotRow {
  rank: number;
  keyword: string;
  search_count: number;
}

@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 로그인 사용자는 최근 검색어(SearchHistory)도 함께 갱신한다 — uk(account_id, keyword) upsert라 soft-delete된
   * 항목은 복원되고 last_used_at만 앞당겨진다. 두 쓰기는 한 트랜잭션으로 묶어 집계 이벤트만 남고 최근 검색어가 빠지는 상태를 막는다.
   */
  async recordSearch(args: {
    accountId: bigint | null;
    keyword: string;
    now: Date;
  }): Promise<void> {
    const event = this.prisma.searchEvent.create({
      data: {
        account_id: args.accountId,
        keyword: args.keyword,
        created_at: args.now,
      },
    });
    if (args.accountId === null) {
      await event;
      return;
    }
    await this.prisma.$transaction([
      event,
      this.prisma.searchHistory.upsert({
        where: {
          account_id_keyword: {
            account_id: args.accountId,
            keyword: args.keyword,
          },
        },
        create: {
          account_id: args.accountId,
          keyword: args.keyword,
          last_used_at: args.now,
        },
        update: { last_used_at: args.now, deleted_at: null },
      }),
    ]);
  }

  /** 동률은 keyword asc로 고정해 스냅샷 순위가 결정적으로 나오게 한다(직전 스냅샷 비교가 흔들리지 않도록). */
  async countKeywordsInWindow(args: {
    since: Date;
    until: Date;
    limit: number;
  }): Promise<KeywordCountRow[]> {
    const rows = await this.prisma.searchEvent.groupBy({
      by: ['keyword'],
      where: { created_at: { gte: args.since, lt: args.until } },
      _count: { _all: true },
      orderBy: [{ _count: { keyword: 'desc' } }, { keyword: 'asc' }],
      take: args.limit,
    });
    return rows.map((r) => ({ keyword: r.keyword, count: r._count._all }));
  }

  async snapshotExists(rankedAt: Date): Promise<boolean> {
    const count = await this.prisma.searchKeywordRankSnapshot.count({
      where: { ranked_at: rankedAt },
    });
    return count > 0;
  }

  /** 같은 ranked_at이 이미 있으면(크론·부트스트랩 경합) uk 충돌을 "이미 생성됨"으로 흡수해 false를 반환한다. */
  async createSnapshot(args: {
    rankedAt: Date;
    rows: KeywordCountRow[];
  }): Promise<boolean> {
    if (args.rows.length === 0) return false;
    try {
      await this.prisma.searchKeywordRankSnapshot.createMany({
        data: args.rows.slice(0, KEYWORD_RANK_SNAPSHOT_SIZE).map((row, i) => ({
          ranked_at: args.rankedAt,
          rank: i + 1,
          keyword: row.keyword,
          search_count: row.count,
        })),
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  async findLatestSnapshotAt(before?: Date): Promise<Date | null> {
    const row = await this.prisma.searchKeywordRankSnapshot.findFirst({
      where: before ? { ranked_at: { lt: before } } : undefined,
      orderBy: { ranked_at: 'desc' },
      select: { ranked_at: true },
    });
    return row?.ranked_at ?? null;
  }

  async listSnapshotRows(
    rankedAt: Date,
    limit?: number,
  ): Promise<KeywordRankSnapshotRow[]> {
    return this.prisma.searchKeywordRankSnapshot.findMany({
      where: { ranked_at: rankedAt },
      orderBy: { rank: 'asc' },
      take: limit,
      select: { rank: true, keyword: true, search_count: true },
    });
  }

  // ── 구매자 최근 검색어(목록·삭제) ──

  async listSearchHistories(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{
    items: {
      id: bigint;
      keyword: string;
      last_used_at: Date;
    }[];
    totalCount: number;
  }> {
    const where = {
      account_id: args.accountId,
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.searchHistory.findMany({
        where,
        orderBy: { last_used_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          keyword: true,
          last_used_at: true,
        },
      }),
      this.prisma.searchHistory.count({ where }),
    ]);

    return { items, totalCount };
  }

  async deleteSearchHistory(args: {
    accountId: bigint;
    id: bigint;
    now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.searchHistory.updateMany({
      where: {
        id: args.id,
        account_id: args.accountId,
        ...activeWhere,
      },
      data: { deleted_at: args.now },
    });
    return result.count > 0;
  }

  async clearSearchHistories(args: {
    accountId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.searchHistory.updateMany({
      where: {
        account_id: args.accountId,
        ...activeWhere,
      },
      data: { deleted_at: args.now },
    });
    return result.count;
  }
}
