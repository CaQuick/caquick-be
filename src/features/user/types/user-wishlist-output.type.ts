import type { OffsetConnection } from '@/common/types/cursor-connection.type';

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

export type MyWishlistConnection = OffsetConnection<WishlistItemSummary>;

export interface WishlistStoreGroup {
  storeId: string;
  storeName: string;
  profileImageUrl: string | null;
  wishlistedProductCount: number;
}

export type MyWishlistStoreGroupsConnection =
  OffsetConnection<WishlistStoreGroup>;
