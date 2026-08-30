import { Injectable } from '@nestjs/common';

import {
  DEFAULT_POPULAR_KEYWORDS_LIMIT,
  HOUR_MS,
  KEYWORD_RANK_SNAPSHOT_SIZE,
  KEYWORD_RANK_WINDOW_HOURS,
  MAX_POPULAR_KEYWORDS_LIMIT,
} from '@/features/search/constants/search.constants';
import type { PopularSearchKeywordsInput } from '@/features/search/dto/inputs/popular-search-keywords.input';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import type {
  PopularSearchKeywordsResult,
  SearchKeywordTrend,
} from '@/features/search/types/search-entry-output.type';

/** 시 단위 절삭(정각). 시간대 오프셋이 정수 시간이라 UTC/KST 어느 쪽 정각과도 일치한다. */
export function truncateToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

@Injectable()
export class SearchKeywordRankService {
  constructor(private readonly repo: SearchRepository) {}

  /**
   * 인기 검색어 스냅샷 생성. ranked_at = now의 정각, 윈도우 = [ranked_at - 24h, ranked_at).
   * 같은 정각 스냅샷이 이미 있으면(크론·부트스트랩 중복 호출) 만들지 않는다(멱등).
   * 이벤트가 하나도 없으면 스냅샷을 남기지 않아 직전 유효 스냅샷이 계속 노출된다.
   * @returns 실제 생성 여부
   */
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

  /**
   * 최신 스냅샷 상위 limit + 직전 스냅샷 대비 변동.
   * 직전 스냅샷은 "가장 최근의 이전 스냅샷"(정확히 1시간 전이 아닐 수 있음 —
   * 서버 다운타임으로 빈 시간이 있어도 비교가 가능하도록. 자체 판단, 시안 외).
   */
  async popularSearchKeywords(
    input?: PopularSearchKeywordsInput,
  ): Promise<PopularSearchKeywordsResult> {
    const limit = Math.min(
      input?.limit ?? DEFAULT_POPULAR_KEYWORDS_LIMIT,
      MAX_POPULAR_KEYWORDS_LIMIT,
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
    const previousRankByKeyword = new Map(
      previous.map((row) => [row.keyword, row.rank]),
    );

    return {
      items: current.map((row) => ({
        rank: row.rank,
        keyword: row.keyword,
        trend: resolveTrend(row.rank, previousRankByKeyword.get(row.keyword)),
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
