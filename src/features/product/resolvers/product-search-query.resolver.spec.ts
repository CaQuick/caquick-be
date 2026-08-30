import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductSearchQueryResolver } from '@/features/product/resolvers/product-search-query.resolver';
import { ProductSearchService } from '@/features/product/services/product-search.service';
import type { JwtUser } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createProduct } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/집계 세부 검증은 service.spec.ts에서 담당.
 */
describe('ProductSearchQueryResolver (real DB)', () => {
  let resolver: ProductSearchQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductSearchQueryResolver,
        ProductSearchService,
        ProductRepository,
        ClockService,
      ],
    });
    resolver = module.get(ProductSearchQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('searchProducts: 비로그인은 isWishlisted=false로 위임한다', async () => {
    await createProduct(prisma, { name: '리졸버 케이크' });

    const result = await resolver.searchProducts(
      { keyword: '리졸버' },
      undefined,
    );

    expect(result.totalCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      name: '리졸버 케이크',
      isWishlisted: false,
    });
  });

  it('searchProducts: 로그인 사용자의 찜 여부를 채운다', async () => {
    const product = await createProduct(prisma, { name: '리졸버 케이크' });
    const account = await createAccount(prisma, { account_type: 'USER' });
    await prisma.wishlistItem.create({
      data: { account_id: account.id, product_id: product.id },
    });
    const user = { accountId: account.id.toString() } as JwtUser;

    const result = await resolver.searchProducts({ keyword: '리졸버' }, user);

    expect(result.items[0].isWishlisted).toBe(true);
  });

  it('searchProductFacets: 가격 분포를 반환한다', async () => {
    await createProduct(prisma, {
      name: '리졸버 케이크',
      regular_price: 12000,
    });

    const result = await resolver.searchProductFacets({ keyword: '리졸버' });

    expect(result.totalCount).toBe(1);
    expect(result.buckets.find((b) => b.minPrice === 10000)?.count).toBe(1);
  });
});
