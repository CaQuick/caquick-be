// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ProductModule } from '@/features/product/product.module';
export {
  ProductRepository,
  // 주문 생성(order feature)의 옵션 검증·가격 스냅샷 입력 타입
  type ProductDetailRow,
} from '@/features/product/repositories/product.repository';
// 할인율 산식(0~100). 상품 카드 표기 규칙 — 찜 목록(user feature)이 동일 정책을 공유한다.
export { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
