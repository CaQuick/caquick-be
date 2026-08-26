export interface WishlistItemSummary {
  productId: string;
  storeId: string;
  productName: string;
  representativeImageUrl: string | null;
  salePrice: number | null;
  regularPrice: number;
  discountRate: number;
  storeName: string;
  regionLabel: string | null;
  ratingAverage: number;
  reviewCount: number;
  addedAt: Date;
}

export interface MyWishlistConnection {
  items: WishlistItemSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface WishlistStoreGroup {
  storeId: string;
  storeName: string;
  profileImageUrl: string | null;
  wishlistedProductCount: number;
}

export interface MyWishlistStoreGroupsConnection {
  items: WishlistStoreGroup[];
  totalCount: number;
  hasMore: boolean;
}
