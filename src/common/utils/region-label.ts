/** 매장 지역 표기(시·동 우선, 없으면 지역명). 매장·상품 카드·리뷰 화면이 같은 규칙을 쓴다. DI-free. */
export function buildRegionLabel(row: {
  address_city: string | null;
  address_neighborhood: string | null;
  region: { name: string } | null;
}): string | null {
  const parts = [row.address_city, row.address_neighborhood].filter(
    (p): p is string => Boolean(p),
  );
  if (parts.length > 0) return parts.join(' ');
  return row.region?.name ?? null;
}
