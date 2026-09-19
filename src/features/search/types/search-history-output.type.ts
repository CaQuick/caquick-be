import type { OffsetConnection } from '@/common/types/cursor-connection.type';

export interface SearchHistoryItem {
  id: string;
  keyword: string;
  lastUsedAt: Date;
}

export type SearchHistoryConnection = OffsetConnection<SearchHistoryItem>;
