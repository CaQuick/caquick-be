import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

/** searchStores resolver 반환용. SDL(store-search.graphql)의 SearchStoreConnection과 필드 일치. */
export type SearchStoreConnection = OffsetConnection<StoreCardOutput>;
