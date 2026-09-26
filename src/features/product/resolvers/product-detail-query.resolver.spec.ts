import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductDetailQueryResolver } from '@/features/product/resolvers/product-detail-query.resolver';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createProduct } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 분기/필터 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('ProductDetail Query Resolver (real DB)', () => {
  let resolver: ProductDetailQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        WishlistRepository,
        ReviewReadRepository,
        ProductDetailQueryResolver,
        ProductDetailService,
        ProductRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
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

  it('productDetail: 없는 상품은 404', async () => {
    await expect(
      resolver.productDetail('999999', undefined),
    ).rejects.toThrowDomain(404);
  });
});
