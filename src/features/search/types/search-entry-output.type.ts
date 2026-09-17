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
