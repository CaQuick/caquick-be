import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductHomeQueryResolver } from '@/features/product/resolvers/product-home-query.resolver';
import { ProductHomeService } from '@/features/product/services/product-home.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 랭킹/배너/필터 세부 검증은 service.spec.ts에서 담당.
 */
describe('ProductHome Query Resolver (real DB)', () => {
  let resolver: ProductHomeQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductHomeQueryResolver,
        ProductHomeService,
        ProductRepository,
      ],
    });
    resolver = module.get(ProductHomeQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('popularCakes: 서비스에 위임해 섹션 데이터를 반환한다', async () => {
    const store = await createStore(prisma);
    await createProduct(prisma, { store_id: store.id, name: '인기 케이크' });

    const result = await resolver.popularCakes();

    expect(result.items.map((i) => i.name)).toEqual(['인기 케이크']);
    expect(result.banner).toBeNull();
  });
});
