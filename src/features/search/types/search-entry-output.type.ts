/**
 * search-entry resolver 반환용 도메인 출력 타입.
 * SDL(search-entry.graphql)의 타입과 필드 일치.
 */

export type SearchKeywordTrend = 'UP' | 'DOWN' | 'SAME' | 'NEW';

export interface PopularSearchKeyword {
  rank: number;
  keyword: string;
  trend: SearchKeywordTrend;
  searchCount: number;
}

export interface PopularSearchKeywordsResult {
  items: PopularSearchKeyword[];
  rankedAt: Date | null;
}
