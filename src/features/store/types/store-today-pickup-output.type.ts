import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

export interface TodayPickupSlot {
  time: string;
  available: boolean;
}

export interface TodayPickupStore {
  store: StoreCardOutput;
  slots: TodayPickupSlot[];
}

export type TodayPickupStoreConnection = OffsetConnection<TodayPickupStore> & {
  asOf: Date;
};
