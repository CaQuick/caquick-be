import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

export type SearchStoreConnection = OffsetConnection<StoreCardOutput>;
