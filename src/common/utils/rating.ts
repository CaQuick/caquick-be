/**
 * 평점 평균 표기 규칙: 소수 첫째 자리 반올림(예: 4.666 → 4.7).
 * 매장·상품·찜 목록 등 노출 지점 전체가 이 규칙을 공유한다.
 */
export function roundRatingAverage(value: number): number {
  return Math.round(value * 10) / 10;
}
