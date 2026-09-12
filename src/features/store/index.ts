// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { StoreModule } from '@/features/store/store.module';
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
export { scoreAndSortByPopularity } from '@/features/store/services/store-ranking.helper';
// 검색 요약(search feature)의 매장 건수. 검색 조건은 store feature의 where 빌더가 단일 소스.
export { StoreSearchService } from '@/features/store/services/store-search.service';
// 매장·사업자 텍스트 컬럼 길이. 판매자(내 매장 수정)와 관리자(온보딩·대리 수정)가 공유한다.
export * from '@/features/store/constants/store-field-limits';
// 매장 기본 정보 부분 수정 규칙(길이·좌표·null 처리). 판매자 수정과 관리자 대리 수정이 같은 함수를 쓴다.
export {
  buildStoreBasicInfoUpdateData,
  type StoreBasicInfoPatch,
} from '@/features/store/services/store-basic-info.helper';
