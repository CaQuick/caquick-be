/** 할인율(0~100, 반올림). 상품 카드·상세·리뷰·주문 목록이 같은 규칙을 쓴다. DI-free. */
export function calcDiscountRate(
  regularPrice: number,
  salePrice: number | null,
): number {
  if (salePrice === null || regularPrice <= 0 || salePrice >= regularPrice) {
    return 0;
  }
  // salePrice가 음수 등 비정상 값이어도 공개 계약(0~100)을 지키도록 clamp
  const rate = Math.round((1 - salePrice / regularPrice) * 100);
  return Math.min(100, Math.max(0, rate));
}
