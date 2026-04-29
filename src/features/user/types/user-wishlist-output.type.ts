export interface WishlistItemSummary {
  productId: string;
  productName: string;
  representativeImageUrl: string | null;
  salePrice: number | null;
  regularPrice: number;
  storeName: string;
  addedAt: Date;
}

export interface MyWishlistConnection {
  items: WishlistItemSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface MyWishlistInput {
  offset?: number | null;
  limit?: number | null;
}
