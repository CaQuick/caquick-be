import type { OffsetConnection } from '@/common/types/cursor-connection.type';

/**
 * store resolver 반환용 도메인 출력 타입.
 * SDL(store.types.graphql)의 PopularStore / PopularStoreConnection 와 필드 일치.
 */

export interface PopularStore {
  id: string;
  rank: number;
  storeName: string;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  cakeImageUrls: string[];
  isWishlisted: boolean;
}

export type PopularStoreConnection = OffsetConnection<PopularStore> & {
  rankedAt: Date;
};
