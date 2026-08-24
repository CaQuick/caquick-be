// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { StoreModule } from '@/features/store/store.module';
export { StoreRepository } from '@/features/store/repositories/store.repository';
// 인기 랭킹 산식·표기 규칙. 상품 랭킹(product feature)이 동일 정책을 공유한다.
export {
  DEFAULT_GLOBAL_RATING_PRIOR,
  RANKING_RECENT_ORDER_DAYS,
  RANKING_VALID_ORDER_STATUSES,
} from '@/features/store/constants/store-ranking.constants';
export { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
// 매장 픽업 가능 판정. 주문 생성(order feature)이 픽업 일시 재검증에 사용한다 —
// 판정 규칙은 store feature에 유지한다(달력·슬롯 조회와 단일 소스).
export { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
export {
  popularityScore,
  type StoreMetrics,
} from '@/features/store/services/store-ranking.helper';
