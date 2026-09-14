/**
 * 홈 전역 픽업 슬롯 정책(매장 무관 고정값).
 *
 * 화면(05)의 달력·시간 선택 UX 제공용. 실제 매장별 영업시간·capacity·휴무 반영은
 * 주문 단계에서 매장 정책으로 별도 검증한다(이 feature 범위 밖).
 * 정책값은 기획 확정 시 이 상수를 교체한다.
 */
export const PICKUP_OPEN_MINUTES = 10 * 60; // 10:00
export const PICKUP_CLOSE_MINUTES = 20 * 60; // 20:00 (미포함 → 마지막 슬롯 19:30)
export const PICKUP_SLOT_INTERVAL_MINUTES = 30;
export const PICKUP_AFTERNOON_START_MINUTES = 12 * 60; // 12:00 (오전/오후 경계)

/** 오늘부터 선택 가능한 최대 일수. */
export const PICKUP_MAX_DAYS_AHEAD = 30;

/** 당일 픽업 최소 리드타임(분). 현재시각 + 이 값 이전 슬롯은 마감. */
export const PICKUP_MIN_LEAD_MINUTES = 60;
