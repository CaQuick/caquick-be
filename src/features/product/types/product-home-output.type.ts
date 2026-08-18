/**
 * product-home resolver 반환용 도메인 출력 타입.
 * SDL(product-home.graphql)의 타입과 필드 일치.
 */

export interface HomeBanner {
  id: string;
  imageUrl: string;
  title: string | null;
  linkCategoryId: string | null;
}

export interface PopularCake {
  id: string;
  rank: number;
  name: string;
  thumbnailUrl: string | null;
  storeName: string;
  regionLabel: string | null;
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
}

export interface PopularCakesResult {
  banner: HomeBanner | null;
  items: PopularCake[];
  rankedAt: Date;
}
