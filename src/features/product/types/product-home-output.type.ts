/**
 * product-home resolver 반환용 도메인 출력 타입.
 * SDL(product-home.graphql)의 타입과 필드 일치.
 */

export interface HomeBanner {
  id: string;
  imageUrl: string;
  title: string | null;
  linkType: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
  linkUrl: string | null;
  linkProductId: string | null;
  linkProductStoreId: string | null;
  linkStoreId: string | null;
  linkCategoryId: string | null;
}

export interface PopularCake {
  id: string;
  storeId: string;
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

export interface RandomCake {
  id: string;
  storeId: string;
  thumbnailUrl: string;
}

export interface RandomCakesResult {
  items: RandomCake[];
}

export interface CustomCakeShowcaseItem {
  reviewId: string;
  storeId: string;
  rank: number;
  authorNickname: string | null;
  reviewText: string | null;
  likeCount: number;
  beforeImageUrl: string;
  afterImageUrl: string;
}
