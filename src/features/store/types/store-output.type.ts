import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

/**
 * store resolver 반환용 도메인 출력 타입.
 * SDL(store.types.graphql)의 PopularStore / PopularStoreConnection 와 필드 일치.
 */

export interface PopularStore {
  rank: number;
  store: StoreCardOutput;
}

export type PopularStoreConnection = OffsetConnection<PopularStore> & {
  rankedAt: Date;
};
