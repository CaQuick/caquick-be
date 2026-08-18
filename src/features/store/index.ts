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
export {
  popularityScore,
  type StoreMetrics,
} from '@/features/store/services/store-ranking.helper';
