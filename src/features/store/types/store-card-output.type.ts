/**
 * 매장 카드 출력 타입. SDL(store.types.graphql)의 StoreCard와 필드 일치.
 * 인기 매장·오늘 픽업·검색·찜 목록이 합성(`store: StoreCard!`)으로 포함한다.
 */
export interface StoreCardOutput {
  id: string;
  storeName: string;
  profileImageUrl: string | null;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  cakeImageUrls: string[];
  isWishlisted: boolean;
}
