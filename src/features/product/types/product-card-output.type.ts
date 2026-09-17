/**
 * 상품 카드 출력 타입. SDL(product.types.graphql)의 ProductCard와 필드 일치.
 * 인기 케이크·판매 Best·검색·매장 상품·찜·최근 본 상품이 합성(`product: ProductCard!`)으로 포함한다.
 */
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
