export const STORE_PICKUP_DAY_REASON = {
  PAST: 'PAST',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  // 특별휴무·요일 휴무·영업시간 미설정·당일 잔여 가용 슬롯 없음을 묶는다.
  // FE 표기가 동일("마감")하고, 세분화는 capacity 소진(CAPACITY_FULL)만 요구되기 때문.
  CLOSED: 'CLOSED',
  CAPACITY_FULL: 'CAPACITY_FULL',
} as const;

export const PICKUP_AFTERNOON_START_MINUTES = 12 * 60;
