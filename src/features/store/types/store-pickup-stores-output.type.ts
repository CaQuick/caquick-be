import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

export interface PickupStoreItem {
  store: StoreCardOutput;
  latitude: number | null;
  longitude: number | null;
}

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type PickupStoreConnection = OffsetConnection<PickupStoreItem> & {
  regionBounds: MapBounds | null;
};
