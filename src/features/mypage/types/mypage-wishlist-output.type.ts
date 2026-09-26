import type { OffsetConnection } from '@/common/types/cursor-connection.type';
import type { ProductCardOutput } from '@/features/product';

export interface WishlistItem {
  product: ProductCardOutput;
  addedAt: Date;
}

export type MyWishlistConnection = OffsetConnection<WishlistItem>;

export interface WishlistStoreGroup {
  storeId: string;
  storeName: string;
  profileImageUrl: string | null;
  wishlistedProductCount: number;
}

export type MyWishlistStoreGroupsConnection =
  OffsetConnection<WishlistStoreGroup>;
