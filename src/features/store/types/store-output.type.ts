import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

export interface PopularStore {
  rank: number;
  store: StoreCardOutput;
}

export type PopularStoreConnection = OffsetConnection<PopularStore> & {
  rankedAt: Date;
};
