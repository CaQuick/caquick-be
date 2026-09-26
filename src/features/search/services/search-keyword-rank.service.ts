import { Injectable } from '@nestjs/common';

import { HOUR_MS } from '@/common/utils/kst-time';
import {
  DEFAULT_POPULAR_KEYWORDS_LIMIT,
  KEYWORD_RANK_SNAPSHOT_SIZE,
  KEYWORD_RANK_WINDOW_HOURS,
} from '@/features/search/constants/search.constants';
import type { PopularSearchKeywordsInput } from '@/features/search/dto/inputs/popular-search-keywords.input';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import type {
  PopularSearchKeywordsResult,
  SearchKeywordTrend,
} from '@/features/search/types/search-entry-output.type';

/** 시간대 오프셋이 정수 시간이라 UTC/KST 어느 쪽 정각과도 일치한다. */
export function truncateToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

@Injectable()
export class SearchKeywordRankService {
  constructor(private readonly repo: SearchRepository) {}

  /** 같은 정각 스냅샷이 이미 있으면 만들지 않는다(멱등). 이벤트가 하나도 없으면 스냅샷을 남기지 않아 직전 유효 스냅샷이 계속 노출된다. */
  async captureSnapshot(now: Date): Promise<boolean> {
    const rankedAt = truncateToHour(now);
    if (await this.repo.snapshotExists(rankedAt)) return false;

    const rows = await this.repo.countKeywordsInWindow({
      since: new Date(rankedAt.getTime() - KEYWORD_RANK_WINDOW_HOURS * HOUR_MS),
      until: rankedAt,
      limit: KEYWORD_RANK_SNAPSHOT_SIZE,
    });
    return this.repo.createSnapshot({ rankedAt, rows });
  }

  /** 직전 스냅샷은 "가장 최근의 이전 스냅샷"(정확히 1시간 전이 아닐 수 있음 — 서버 다운타임으로 빈 시간이 있어도 비교가 가능하도록). */
  async popularSearchKeywords(
    input?: PopularSearchKeywordsInput,
  ): Promise<PopularSearchKeywordsResult> {
    const limit = Math.min(
      input?.limit ?? DEFAULT_POPULAR_KEYWORDS_LIMIT,
      KEYWORD_RANK_SNAPSHOT_SIZE,
    );

    const rankedAt = await this.repo.findLatestSnapshotAt();
    if (rankedAt === null) return { items: [], rankedAt: null };

    const previousAt = await this.repo.findLatestSnapshotAt(rankedAt);
    const [current, previous] = await Promise.all([
      this.repo.listSnapshotRows(rankedAt, limit),
      previousAt === null
        ? Promise.resolve([])
        : this.repo.listSnapshotRows(previousAt),
    ]);
    // GROUP BY는 collation(ci) 기준으로 묶여 스냅샷마다 대표 표기(대소문자)가 다를 수 있다('3d' ↔ '3D').
    // JS Map은 대소문자를 구분하므로 소문자 키로 비교해 같은 검색어가 NEW로 오판되지 않게 방어한다.
    const previousRankByKeyword = new Map(
      previous.map((row) => [row.keyword.toLowerCase(), row.rank]),
    );

    return {
      items: current.map((row) => ({
        rank: row.rank,
        keyword: row.keyword,
        trend: resolveTrend(
          row.rank,
          previousRankByKeyword.get(row.keyword.toLowerCase()),
        ),
        searchCount: row.search_count,
      })),
      rankedAt,
    };
  }
}

function resolveTrend(
  rank: number,
  previousRank: number | undefined,
): SearchKeywordTrend {
  if (previousRank === undefined) return 'NEW';
  if (previousRank > rank) return 'UP';
  if (previousRank < rank) return 'DOWN';
  return 'SAME';
}
