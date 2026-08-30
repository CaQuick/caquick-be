// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ProductModule } from '@/features/product/product.module';
export {
  ProductRepository,
  // 주문 생성(order feature)의 옵션 검증·가격 스냅샷 입력 타입
  type ProductDetailRow,
} from '@/features/product/repositories/product.repository';
// 할인율 산식(0~100). 상품 카드 표기 규칙 — 찜 목록(user feature)이 동일 정책을 공유한다.
export { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
// 검색 진입 화면(search feature)이 소비하는 실시간 판매 Best·배너 매퍼·출력 타입.
// 랭킹·카드 표기 규칙은 product feature에 유지한다(홈 인기 케이크와 단일 소스).
export { RealtimeBestCakesInput } from '@/features/product/dto/inputs/realtime-best-cakes.input';
export { ProductBestSellerService } from '@/features/product/services/product-best-seller.service';
export { toHomeBanner } from '@/features/product/services/product-home-mappers.helper';
export type { RealtimeBestCakesResult } from '@/features/product/types/product-best-seller-output.type';
export type { HomeBanner } from '@/features/product/types/product-home-output.type';
