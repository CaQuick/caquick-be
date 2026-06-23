import type {
  StoreDetailRow,
  StoreReviewStat,
} from '@/features/store/repositories/store.repository';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import type { StoreDetail } from '@/features/store/types/store-detail-output.type';

/** 소수 첫째 자리 반올림(예: 4.666 → 4.7). 리뷰 없으면 0. */
function toRatingAverage(stat: StoreReviewStat | undefined): number {
  if (!stat) return 0;
  return Math.round(stat.average * 10) / 10;
}

/** Decimal(위/경도)을 number로. null은 유지. */
function toCoordinate(value: { toString(): string } | null): number | null {
  return value !== null ? Number(value) : null;
}

export function toStoreDetail(
  row: StoreDetailRow,
  reviewStat: StoreReviewStat | undefined,
  isWishlisted: boolean,
): StoreDetail {
  return {
    id: row.id.toString(),
    storeName: row.store_name,
    regionLabel: buildRegionLabel(row),
    ratingAverage: toRatingAverage(reviewStat),
    reviewCount: reviewStat?.count ?? 0,
    isWishlisted,
    images: row.store_images.map((image) => image.image_url),
    phoneNumber: row.store_phone,
    addressFull: row.address_full,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    mapProvider: row.map_provider,
    businessHoursText: row.business_hours_text,
    regularClosureText: row.regular_closure_text,
    accessGuideText: row.access_guide_text,
    websiteUrl: row.website_url,
  };
}
