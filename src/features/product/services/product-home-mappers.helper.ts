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

export function toHomeBanner(row: HomeBannerRow): HomeBanner {
  return {
    id: row.id.toString(),
    imageUrl: row.image_url,
    title: row.title,
    linkType: row.link_type,
    linkUrl: row.link_url,
    linkProductId: row.link_product_id?.toString() ?? null,
    linkStoreId: row.link_store_id?.toString() ?? null,
    linkCategoryId: row.link_category_id?.toString() ?? null,
  };
}

export function toPopularCake(
  row: CakeCandidateRow,
  rank: number,
): PopularCake {
  return {
    id: row.id.toString(),
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
