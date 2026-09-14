import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import { buildRegionLabel } from '@/features/store';

/**
 * 상품 카드 공통 필드를 만드는 데 필요한 product 컬럼.
 * 홈 인기 케이크·검색 결과·찜 목록·최근 본 상품이 같은 표기 규칙을 쓴다 —
 * 대표 이미지 선택(sort_order 최소 1건)·할인율 산식·지역 표기가 화면마다
 * 어긋나면 같은 상품이 화면별로 다른 가격표를 달게 된다.
 */
export interface ProductCardFields {
  store_id: bigint;
  name: string;
  regular_price: number;
  sale_price: number | null;
  store: {
    store_name: string;
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  };
  images: { image_url: string }[];
}

/** SDL의 상품 카드 공통 9필드. 화면별 타입은 여기에 자기 필드만 얹는다. */
export interface ProductCardCore {
  id: string;
  storeId: string;
  name: string;
  thumbnailUrl: string | null;
  storeName: string;
  regionLabel: string | null;
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
}

/**
 * id를 따로 받는 이유: 찜·최근 본 상품은 조인 행이라 상품 id가 `product_id`로
 * 한 단계 바깥에 있다.
 */
export function toProductCardCore(
  id: bigint,
  product: ProductCardFields,
): ProductCardCore {
  return {
    id: id.toString(),
    storeId: product.store_id.toString(),
    name: product.name,
    thumbnailUrl: product.images[0]?.image_url ?? null,
    storeName: product.store.store_name,
    regionLabel: buildRegionLabel(product.store),
    regularPrice: product.regular_price,
    salePrice: product.sale_price,
    discountRate: calcDiscountRate(product.regular_price, product.sale_price),
  };
}
