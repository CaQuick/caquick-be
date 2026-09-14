import type { ProductCardCore } from '@/features/product';

export interface WishlistItemSummary extends ProductCardCore {
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
