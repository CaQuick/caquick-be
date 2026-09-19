/**
 * catalog(매장 픽업 판정)가 order에 묻는 "예약된 제작 수량" 읽기 포트(D7-a).
 * order → store 의존(픽업 재검증)이 이미 있어 store → order를 모듈로 잇지 못하므로,
 * 토큰·계약은 무의존 common에 두고 order가 구현을 제공한다(순환 없음).
 */
export const BOOKED_QUANTITY_QUERY = Symbol('BOOKED_QUANTITY_QUERY');

export interface IBookedQuantityQuery {
  /** 매장별 [rangeStartUtc, rangeEndUtc) 픽업 예약 수량 합(CANCELED·soft-delete 제외). 없는 매장은 키가 없다. */
  sumByStore(
    storeIds: bigint[],
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<Map<bigint, number>>;
  /** 한 매장의 KST 달력일('YYYY-MM-DD')별 픽업 예약 수량 합. */
  sumByKstDate(
    storeId: bigint,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<Map<string, number>>;
}
