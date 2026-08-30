import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { ProductRepository, ProductSearchService } from '@/features/product';
import { SearchResultService } from '@/features/search/services/search-result.service';
import { StoreSearchService } from '@/features/store';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createRegion, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SearchResultService (real DB)', () => {
  let service: SearchResultService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SearchResultService,
        ProductSearchService,
        ProductRepository,
        StoreSearchService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
      ],
    });
    service = module.get(SearchResultService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('searchSummary', () => {
    it('상품/매장 건수를 각각 센다(활성만)', async () => {
      const store = await createStore(prisma, {
        store_name: '크리스마스 하우스',
      });
      await createStore(prisma, {
        store_name: '크리스마스 공방',
        is_active: false,
      });
      await createProduct(prisma, {
        store_id: store.id,
        name: '크리스마스 케이크',
      });
      await createProduct(prisma, {
        store_id: store.id,
        name: '미리 크리스마스',
      });
      await createProduct(prisma, { store_id: store.id, name: '생일 케이크' });

      expect(await service.searchSummary({ keyword: ' 크리스마스 ' })).toEqual({
        productCount: 2,
        storeCount: 1,
      });
    });

    it('regionIds를 두 카운트에 모두 적용한다', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-sum' });
      const inRegion = await createStore(prisma, {
        store_name: '케이크 지역',
        region_id: region.id,
      });
      const outRegion = await createStore(prisma, {
        store_name: '케이크 타지역',
      });
      await createProduct(prisma, { store_id: inRegion.id, name: '케이크' });
      await createProduct(prisma, { store_id: outRegion.id, name: '케이크' });

      expect(
        await service.searchSummary({
          keyword: '케이크',
          regionIds: [region.id.toString()],
        }),
      ).toEqual({ productCount: 1, storeCount: 1 });
    });

    it('빈 검색어는 400', async () => {
      await expect(service.searchSummary({ keyword: '' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
