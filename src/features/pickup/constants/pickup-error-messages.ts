export const PICKUP_ERRORS = {
  INVALID_YEAR_MONTH: '유효하지 않은 연월 형식입니다. (YYYY-MM)',
  INVALID_DATE: '유효하지 않은 날짜 형식입니다. (YYYY-MM-DD)',
} as const;

/** 선택 불가 날짜 사유 코드. */
export const PICKUP_DAY_REASON = {
  PAST: 'PAST',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  CLOSED: 'CLOSED', // 당일이지만 현재시각+리드타임으로 가용 슬롯이 없음
} as const;
