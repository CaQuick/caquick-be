export interface ProductCardOutput {
  id: string;
  storeId: string;
  name: string;
  thumbnailUrl: string | null;
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
  storeName: string;
  regionLabel: string | null;
  ratingAverage: number;
  reviewCount: number;
  isWishlisted: boolean;
}
