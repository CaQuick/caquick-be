import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

/**
 * store-today-pickup resolver 반환용 도메인 출력 타입.
 * SDL(store-today-pickup.graphql)의 타입과 필드 일치.
 */

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
