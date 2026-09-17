/** 매장·상품·찜 목록 등 노출 지점 전체가 같은 표기 규칙을 공유한다. */
export function roundRatingAverage(value: number): number {
  return Math.round(value * 10) / 10;
}
