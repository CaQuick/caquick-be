import type { ProductCardOutput } from '@/features/product/types/product-card-output.type';

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
  rank: number;
  product: ProductCardOutput;
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
