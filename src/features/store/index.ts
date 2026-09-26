// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { StoreModule } from '@/features/store/store.module';
// 인기 랭킹 산식·표기 규칙. 상품 랭킹(product feature)이 동일 정책을 공유한다.
export {
  DEFAULT_GLOBAL_RATING_PRIOR,
  RANKING_RECENT_ORDER_DAYS,
} from '@/features/store/constants/store-ranking.constants';
// 매장 픽업 가능 판정. 주문 생성(order feature)이 픽업 일시 재검증에 사용한다 —
// 판정 규칙은 store feature에 유지한다(달력·슬롯 조회와 단일 소스).
export { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
export { scoreAndSortByPopularity } from '@/features/store/services/store-ranking.helper';
// 검색 요약(search feature)의 매장 건수. 검색 조건은 store feature의 where 빌더가 단일 소스.
export { StoreSearchService } from '@/features/store/services/store-search.service';
// 주문 기반 통계(최근 유효 주문 수·판매 수량). 상품 랭킹·판매 Best(product feature)가 같은 유효 주문 정의를 공유한다.
export { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
// 매장·사업자 텍스트 컬럼 길이. 판매자(내 매장 수정)와 관리자(온보딩·대리 수정)가 공유한다.
export * from '@/features/store/constants/store-field-limits';
// 영업시간 표기(주문 상세의 매장 정보). 매장 도메인 규칙이라 store가 소유한다.
export { formatBusinessHours } from '@/features/store/services/business-hours-formatter';
// 판매자 컨텍스트(계정→매장)와 공통 검증 베이스. seller 파생 서비스(상품·주문·대화·감사)가 상속한다 — P1-6(DB 재조회 유지).
export { SellerBaseService } from '@/features/store/services/store-seller-base.service';
export { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
export * from '@/features/store/constants/store-map-provider.constants';
// 관리자 매장 집계(dashboard feature).
export { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
// conversation이 매장 컨텍스트·FAQ를 묻는 읽기 포트. 토큰 주입 — 서비스로 분리되면 클라이언트 구현으로 교체한다.
export {
  CATALOG_QUERY,
  type ICatalogQuery,
} from '@/features/store/repositories/store-catalog-query.repository.interface';
// 일일 capacity 변경 이벤트 계약(outbox, D7-a). 소비자(order)가 복제본을 갱신한다.
export {
  parseStoreDailyCapacityChangedPayload,
  STORE_DAILY_CAPACITY_CHANGED,
} from '@/features/store/events/store-daily-capacity-changed.event';
