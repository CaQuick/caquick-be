/**
 * store-today-pickup resolver 반환용 도메인 출력 타입.
 * SDL(store-today-pickup.graphql)의 타입과 필드 일치.
 */

export interface TodayPickupSlot {
  time: string;
  available: boolean;
}

export interface TodayPickupStore {
  id: string;
  storeName: string;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  cakeImageUrls: string[];
  isWishlisted: boolean;
  slots: TodayPickupSlot[];
}

export interface TodayPickupStoreConnection {
  items: TodayPickupStore[];
  totalCount: number;
  hasMore: boolean;
  asOf: Date;
}
