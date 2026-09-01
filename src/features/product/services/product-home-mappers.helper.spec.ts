import type { HomeBannerRow } from '@/features/product/repositories/product.repository';
import { toHomeBanner } from '@/features/product/services/product-home-mappers.helper';

// 모든 링크 필드가 채워진 stale row — Banner 스키마에 상호 배타 제약이 없어
// 시드·수동 DB·향후 어드민 경로로 실제 발생 가능한 형태다.
function makeBannerRow(o: Partial<HomeBannerRow> = {}): HomeBannerRow {
  return {
    id: 1n,
    image_url: 'https://img/banner.png',
    title: '배너',
    link_type: 'NONE',
    link_url: 'https://event.caquick.dev',
    link_product_id: 10n,
    link_product: { store_id: 20n },
    link_store_id: 30n,
    link_category_id: 40n,
    ...o,
  };
}

describe('toHomeBanner', () => {
  it('linkType=NONE이면 stale 링크 값이 남아 있어도 전부 null로 내린다', () => {
    expect(toHomeBanner(makeBannerRow())).toMatchObject({
      linkType: 'NONE',
      linkUrl: null,
      linkProductId: null,
      linkProductStoreId: null,
      linkStoreId: null,
      linkCategoryId: null,
    });
  });

  it('linkType=PRODUCT면 상품 ID와 소속 매장 ID만 채운다', () => {
    expect(toHomeBanner(makeBannerRow({ link_type: 'PRODUCT' }))).toMatchObject(
      {
        linkProductId: '10',
        linkProductStoreId: '20',
        linkUrl: null,
        linkStoreId: null,
        linkCategoryId: null,
      },
    );
  });

  it('linkType=STORE면 매장 ID만 채운다', () => {
    expect(toHomeBanner(makeBannerRow({ link_type: 'STORE' }))).toMatchObject({
      linkStoreId: '30',
      linkProductId: null,
      linkProductStoreId: null,
      linkUrl: null,
      linkCategoryId: null,
    });
  });

  it('linkType=CATEGORY면 카테고리 ID만 채운다', () => {
    expect(
      toHomeBanner(makeBannerRow({ link_type: 'CATEGORY' })),
    ).toMatchObject({
      linkCategoryId: '40',
      linkProductId: null,
      linkProductStoreId: null,
      linkUrl: null,
      linkStoreId: null,
    });
  });

  it('linkType=URL이면 이동 URL만 채운다', () => {
    expect(toHomeBanner(makeBannerRow({ link_type: 'URL' }))).toMatchObject({
      linkUrl: 'https://event.caquick.dev',
      linkProductId: null,
      linkProductStoreId: null,
      linkStoreId: null,
      linkCategoryId: null,
    });
  });

  // link_type과 링크 값이 동시에 비어 있는 정상 row에서도 null 안전해야 한다
  it('linkType에 대응하는 링크 값이 없으면 null을 반환한다', () => {
    expect(
      toHomeBanner(
        makeBannerRow({
          link_type: 'PRODUCT',
          link_product_id: null,
          link_product: null,
        }),
      ),
    ).toMatchObject({ linkProductId: null, linkProductStoreId: null });
  });

  it('id·이미지·제목은 그대로 매핑한다', () => {
    expect(toHomeBanner(makeBannerRow({ id: 7n, title: null }))).toMatchObject({
      id: '7',
      imageUrl: 'https://img/banner.png',
      title: null,
    });
  });
});
