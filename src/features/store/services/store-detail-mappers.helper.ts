import { roundRatingAverage } from '@/common/utils/rating';
import type { ReviewStat } from '@/features/review';
import type { StoreDetailRow } from '@/features/store/repositories/store.repository';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import type { StoreDetail } from '@/features/store/types/store-detail-output.type';

function toRatingAverage(stat: ReviewStat | undefined): number {
  if (!stat) return 0;
  return roundRatingAverage(stat.average);
}

function toCoordinate(value: { toString(): string } | null): number | null {
  return value !== null ? Number(value) : null;
}

export function toStoreDetail(
  row: StoreDetailRow,
  reviewStat: ReviewStat | undefined,
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
