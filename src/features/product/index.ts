// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ProductModule } from '@/features/product/product.module';
export {
  ProductRepository,
  // 주문 생성(order feature)의 옵션 검증·가격 스냅샷 입력 타입
  type ProductDetailRow,
} from '@/features/product/repositories/product.repository';
// 커스텀 방식 준비 상태. 판매자 방식 변경과 주문 생성(order feature)이 같은 판정을 쓴다.
export {
  evaluateProductCustomIssues,
  type ProductCustomIssue,
} from '@/features/product/services/product-custom-readiness.helper';
// 주문 생성(order feature)의 3D 디자인 검증. 입력은 product 구조 타입이라 order DTO가 이 구조를 만족한다.
export {
  validateThreeDDesign,
  type ThreeDDesignSource,
  type ThreeDDesignV1,
} from '@/features/product/services/three-d-design.helper';
// 주문 상세가 저장된 3D 디자인을 읽을 때 지원하는 JSON 버전.
export { THREE_D_DESIGN_SCHEMA_VERSION } from '@/features/product/constants/custom-3d-catalog.constants';
// 주문 생성의 커스텀 입력 구조·입력 해시 정규형과 문구 자리·자유 편집 영역 좌표계.
export {
  canonicalizeCustomOrderInput,
  type CustomOrderInputSource,
} from '@/features/product/services/custom-order-input.helper';
export { CUSTOM_AREA_SCALE } from '@/features/product/constants/product-seller.constants';
// 상품 카드 1벌. 찜·최근 본 상품(user feature)이 같은 카드를 쓴다.
export { ProductCardService } from '@/features/product/services/product-card.service';
export type { ProductCardOutput } from '@/features/product/types/product-card-output.type';
// 검색 진입 화면(search feature)이 소비하는 실시간 판매 Best·배너 매퍼·출력 타입.
// 랭킹·카드 표기 규칙은 product feature에 유지한다(홈 인기 케이크와 단일 소스).
export { RealtimeBestCakesInput } from '@/features/product/dto/inputs/realtime-best-cakes.input';
export { ProductBestSellerService } from '@/features/product/services/product-best-seller.service';
export { toHomeBanner } from '@/features/product/services/product-home-mappers.helper';
export type { RealtimeBestCakesResult } from '@/features/product/types/product-best-seller-output.type';
export type { HomeBanner } from '@/features/product/types/product-home-output.type';
// 검색 요약(search feature)의 상품 건수. 검색 조건은 product feature의 where 빌더가 단일 소스.
export { ProductSearchService } from '@/features/product/services/product-search.service';
// 관리자 상품 집계(dashboard feature).
export { ProductAdminRepository } from '@/features/product/repositories/product-admin.repository';
