import { Test } from '@nestjs/testing';

import { ProductCustomCatalogQueryResolver } from '@/features/product/resolvers/product-custom-catalog-query.resolver';
import { ProductCustomCatalogService } from '@/features/product/services/product-custom-catalog.service';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

const ASSET_BASE =
  'https://caquick-media-test.s3.ap-northeast-2.amazonaws.com/custom-3d-catalog/v1';

describe('ProductCustomCatalogQueryResolver', () => {
  let resolver: ProductCustomCatalogQueryResolver;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ...s3TestProviders(),
        ProductCustomCatalogService,
        ProductCustomCatalogQueryResolver,
      ],
    }).compile();
    resolver = module.get(ProductCustomCatalogQueryResolver);
  });

  it('카탈로그 상수를 내보내고 에셋 경로를 이 버킷의 공개 URL로 바꾼다', () => {
    const catalog = resolver.customThreeDCatalog();

    expect(catalog).toMatchObject({
      revision: 1,
      designSchemaVersion: 1,
      defaultTextColor: '#1D1D1D',
      limits: { maxTextsPerFace: 10, maxTextLength: 30 },
    });
    expect(
      catalog.optionChoices
        .filter((c) => c.key === 'design.wave' || c.key === 'shape.heart')
        .map((c) => [c.key, c.imageUrl]),
    ).toEqual([
      ['shape.heart', null],
      ['design.wave', `${ASSET_BASE}/design/wave.png`],
    ]);
    expect(catalog.optionChoices[0]).not.toHaveProperty('imagePath');
    expect(catalog.decos[0]).toEqual({
      key: 'number-0',
      category: 'number',
      label: '0',
      imageUrl: `${ASSET_BASE}/deco/number-0.png`,
      selectable: true,
    });
  });

  it('요청마다 같은 결과를 다시 만들지 않는다', () => {
    expect(resolver.customThreeDCatalog()).toBe(resolver.customThreeDCatalog());
  });
});
