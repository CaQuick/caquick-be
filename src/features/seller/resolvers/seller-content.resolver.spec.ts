import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerContentMutationResolver } from '@/features/seller/resolvers/seller-content-mutation.resolver';
import { SellerContentQueryResolver } from '@/features/seller/resolvers/seller-content-query.resolver';
import { SellerContentService } from '@/features/seller/services/seller-content.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Content Resolvers (real DB)', () => {
  let queryResolver: SellerContentQueryResolver;
  let mutationResolver: SellerContentMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerContentQueryResolver,
        SellerContentMutationResolver,
        SellerContentService,
        SellerRepository,
        ProductRepository,
      ],
    });
    queryResolver = module.get(SellerContentQueryResolver);
    mutationResolver = module.get(SellerContentMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Mutation.sellerCreateFaqTopic + Query.sellerFaqTopics: DB 왕복 반영', async () => {
    const { account } = await setupSellerWithStore(prisma);
    await mutationResolver.sellerCreateFaqTopic(
      { accountId: account.id.toString() },
      { title: 'F1', answerHtml: '<p>a</p>' } as never,
    );
    const result = await queryResolver.sellerFaqTopics({
      accountId: account.id.toString(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('F1');
  });

  it('Mutation.sellerDeleteFaqTopic: 타 매장 topic이면 NotFoundException 전파', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersFaq = await prisma.storeFaqTopic.create({
      data: { store_id: other.store.id, title: 'X', answer_html: '<p>x</p>' },
    });

    await expect(
      mutationResolver.sellerDeleteFaqTopic(
        { accountId: me.account.id.toString() },
        othersFaq.id.toString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('Query.sellerBanners: 판매자 본인 store 배너만 반환', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    await prisma.banner.create({
      data: {
        placement: 'STORE',
        image_url: 'https://i.example/a.png',
        link_type: 'STORE',
        link_store_id: store.id,
      },
    });
    const result = await queryResolver.sellerBanners({
      accountId: account.id.toString(),
    });
    expect(result.items).toHaveLength(1);
  });
});
