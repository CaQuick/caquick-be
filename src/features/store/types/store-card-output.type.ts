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
