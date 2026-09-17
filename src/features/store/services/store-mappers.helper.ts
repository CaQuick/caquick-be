/** 시/동 조합 우선, 없으면 2차 지역명(표기 규칙 확정 전 기본형). */
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
