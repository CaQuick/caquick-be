import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { StoreCardOutput } from '@/features/store/types/store-card-output.type';

/**
 * store-wishlist resolver 반환용 도메인 출력 타입.
 * SDL(store-wishlist.graphql)의 WishlistedStore / MyWishlistedStoresConnection 와 필드 일치.
 */

export interface WishlistedStore {
  store: StoreCardOutput;
  addedAt: Date;
}

export type MyWishlistedStoresConnection = OffsetConnection<WishlistedStore>;
