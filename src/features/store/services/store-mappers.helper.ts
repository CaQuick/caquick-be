import type { StoreCandidateRow } from '@/features/store/repositories/store.repository';
import type { StoreMetrics } from '@/features/store/services/store-ranking.helper';
import type { PopularStore } from '@/features/store/types/store-output.type';

/** 매장 위치 표기. 시/동 조합 우선, 없으면 2차 지역명. (표기 규칙 확정 전 기본형) */
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

export function toPopularStore(
  row: StoreCandidateRow,
  metrics: StoreMetrics,
  rank: number,
  cakeImageUrls: string[],
  isWishlisted: boolean,
): PopularStore {
  return {
    id: row.id.toString(),
    rank,
    storeName: row.store_name,
    // 소수 첫째 자리까지(예: 4.666 → 4.7)
    ratingAverage: Math.round(metrics.ratingAverage * 10) / 10,
    reviewCount: metrics.reviewCount,
    regionLabel: buildRegionLabel(row),
    cakeImageUrls,
    isWishlisted,
  };
}
