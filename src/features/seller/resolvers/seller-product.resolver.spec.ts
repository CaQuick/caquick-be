import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Product Resolvers (real DB)', () => {
  let queryResolver: SellerProductQueryResolver;
  let mutationResolver: SellerProductMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductQueryResolver,
        SellerProductMutationResolver,
        SellerProductCrudService,
        SellerOptionService,
        SellerCustomTemplateService,
        SellerRepository,
        ProductRepository,
      ],
    });
    queryResolver = module.get(SellerProductQueryResolver);
    mutationResolver = module.get(SellerProductMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Mutation.sellerCreateProduct + Query.sellerProducts: DB 왕복 반영', async () => {
    const { account } = await setupSellerWithStore(prisma);

    const created = await mutationResolver.sellerCreateProduct(
      { accountId: account.id.toString() },
      {
        name: '신상',
        regularPrice: 10000,
        initialImageUrl: 'https://i.example/a.png',
      } as never,
    );
    expect(created.name).toBe('신상');

    const list = await queryResolver.sellerProducts({
      accountId: account.id.toString(),
    });
    expect(list.items).toHaveLength(1);
  });

  it('Mutation.sellerDeleteProduct: 타 store 상품 접근은 NotFoundException 전파', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersProduct = await createProduct(prisma, {
      store_id: other.store.id,
    });

    await expect(
      mutationResolver.sellerDeleteProduct(
        { accountId: me.account.id.toString() },
        othersProduct.id.toString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('Mutation.sellerCreateOptionGroup: option 서비스 예외(BadRequest) 전파', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });

    await expect(
      mutationResolver.sellerCreateOptionGroup(
        { accountId: account.id.toString() },
        {
          productId: product.id.toString(),
          name: 'X',
          minSelect: 3,
          maxSelect: 1,
        } as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
