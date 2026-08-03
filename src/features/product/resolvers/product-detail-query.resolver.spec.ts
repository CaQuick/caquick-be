import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductDetailQueryResolver } from '@/features/product/resolvers/product-detail-query.resolver';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createProduct } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/필터 세부 검증은 service.spec.ts에서 담당.
 */
describe('ProductDetail Query Resolver (real DB)', () => {
  let resolver: ProductDetailQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductDetailQueryResolver,
        ProductDetailService,
        ProductRepository,
      ],
    });
    resolver = module.get(ProductDetailQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('productDetail: 비로그인 사용자에게 상품 상세를 반환한다', async () => {
    const product = await createProduct(prisma, { name: '그림일기 케이크' });

    const result = await resolver.productDetail(
      product.id.toString(),
      undefined,
    );

    expect(result.id).toBe(product.id.toString());
    expect(result.name).toBe('그림일기 케이크');
    expect(result.isWishlisted).toBe(false);
  });

  it('productDetail: 로그인 사용자(JwtUser)의 찜 여부를 채운다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const product = await createProduct(prisma);
    await prisma.wishlistItem.create({
      data: { account_id: account.id, product_id: product.id },
    });

    const result = await resolver.productDetail(product.id.toString(), {
      accountId: account.id.toString(),
    });

    expect(result.isWishlisted).toBe(true);
  });

  it('productDetail: 없는 상품은 NotFoundException', async () => {
    await expect(
      resolver.productDetail('999999', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
