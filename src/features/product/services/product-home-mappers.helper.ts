import type {
  CakeCandidateRow,
  HomeBannerRow,
} from '@/features/product/repositories/product.repository';
import { calcDiscountRate } from '@/features/product/services/product-storefront-mappers.helper';
import type {
  HomeBanner,
  PopularCake,
} from '@/features/product/types/product-home-output.type';
import { buildRegionLabel } from '@/features/store';

/**
 * SDL 계약("linkType에 대응하는 링크 필드 하나만 채워진다")을 매퍼에서 강제한다.
 * Banner 스키마에 링크 필드 상호 배타 제약이 없어 시드·수동 DB·향후 어드민 경로로
 * stale 값이 남을 수 있고, findFirstBanner의 where도 NONE/URL 배너의 link_*_id는 보지 않아
 * 그대로 통과한다 — 게이트가 없으면 linkType과 어긋난 링크 필드가 FE로 새어 나간다.
 */
export function toHomeBanner(row: HomeBannerRow): HomeBanner {
  const isProductLink = row.link_type === 'PRODUCT';

  return {
    id: row.id.toString(),
    imageUrl: row.image_url,
    title: row.title,
    linkType: row.link_type,
    linkUrl: row.link_type === 'URL' ? row.link_url : null,
    linkProductId: isProductLink
      ? (row.link_product_id?.toString() ?? null)
      : null,
    linkProductStoreId: isProductLink
      ? (row.link_product?.store_id.toString() ?? null)
      : null,
    linkStoreId:
      row.link_type === 'STORE'
        ? (row.link_store_id?.toString() ?? null)
        : null,
    linkCategoryId:
      row.link_type === 'CATEGORY'
        ? (row.link_category_id?.toString() ?? null)
        : null,
  };
}

export function toPopularCake(
  row: CakeCandidateRow,
  rank: number,
): PopularCake {
  return {
    id: row.id.toString(),
    storeId: row.store_id.toString(),
    rank,
    name: row.name,
    thumbnailUrl: row.images[0]?.image_url ?? null,
    storeName: row.store.store_name,
    regionLabel: buildRegionLabel(row.store),
    regularPrice: row.regular_price,
    salePrice: row.sale_price,
    discountRate: calcDiscountRate(row.regular_price, row.sale_price),
  };
}
