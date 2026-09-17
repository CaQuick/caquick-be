import type { OffsetConnection } from '@/common/types/cursor-connection.type';

/**
 * store-wishlist resolver 반환용 도메인 출력 타입.
 * SDL(store-wishlist.graphql)의 WishlistedStoreSummary / MyWishlistedStoresConnection 와 필드 일치.
 */

export interface WishlistedStoreSummary {
  storeId: string;
  storeName: string;
  profileImageUrl: string | null;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  imageUrls: string[];
  addedAt: Date;
}

export type MyWishlistedStoresConnection =
  OffsetConnection<WishlistedStoreSummary>;
