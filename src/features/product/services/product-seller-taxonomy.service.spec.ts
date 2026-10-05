import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { SellerProductTaxonomyService } from '@/features/product/services/product-seller-taxonomy.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createTag,
  linkProductTag,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerProductTaxonomyService (real DB)', () => {
  let service: SellerProductTaxonomyService;
  let repository: ProductRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductTaxonomyService,
        StoreSellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerProductTaxonomyService);
    repository = module.get(ProductRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createSellerProduct(storeId: bigint, overrides = {}) {
    const product = await createProduct(prisma, {
      store_id: storeId,
      ...overrides,
    });
    await prisma.productImage.create({
      data: {
        product_id: product.id,
        image_url: `https://img.example/${product.id}.png`,
        sort_order: 0,
      },
    });
    return product;
  }

  describe('sellerSetProductCategories', () => {
    it('존재하지 않는 productId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductCategories(account.id, {
          productId: '999999',
          categoryIds: [],
        }),
      ).rejects.toThrowDomain(404);
    });

    it('존재하지 않는 categoryId가 있으면 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerSetProductCategories(account.id, {
          productId: product.id.toString(),
          categoryIds: ['999999'],
        }),
      ).rejects.toThrowDomain(400);
    });

    it('카테고리 할당 + product detail에 포함', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const cat1 = await prisma.category.create({
        data: { name: '생일', category_type: 'EVENT' },
      });

      const result = await service.sellerSetProductCategories(account.id, {
        productId: product.id.toString(),
        categoryIds: [cat1.id.toString()],
      });
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('생일');
    });
  });

  describe('sellerSetProductTags', () => {
    it('존재하지 않는 productId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductTags(account.id, {
          productId: '999999',
          tagIds: [],
        }),
      ).rejects.toThrowDomain(404);
    });

    it('존재하지 않는 tagId가 있으면 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerSetProductTags(account.id, {
          productId: product.id.toString(),
          tagIds: ['999999'],
        }),
      ).rejects.toThrowDomain(400);
    });

    it('태그 할당', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const tag = await prisma.tag.create({ data: { name: '레터링' } });

      const result = await service.sellerSetProductTags(account.id, {
        productId: product.id.toString(),
        tagIds: [tag.id.toString()],
      });
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].name).toBe('레터링');
    });
  });

  describe('sellerSearchTags', () => {
    async function createTags(names: string[]) {
      for (const name of names) await createTag(prisma, { name });
    }

    it('정규화한 keyword로 부분일치하고 이름순이되 정확 일치가 맨 앞', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await createTags(['cake pop', 'birthday cake', 'cake', 'cookie']);

      const result = await service.sellerSearchTags(account.id, {
        keyword: ' #CAKE ',
      });
      expect(result.map((r) => [r.name, r.isExactMatch])).toEqual([
        ['cake', true],
        ['birthday cake', false],
        ['cake pop', false],
      ]);
    });

    it('관리자가 대문자로 만든 Cake도 cake 검색에 정확 일치로 잡힌다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await createTags(['Cake']);

      const result = await service.sellerSearchTags(account.id, {
        keyword: 'cake',
      });
      expect(result).toEqual([
        expect.objectContaining({ name: 'Cake', isExactMatch: true }),
      ]);
    });

    it('soft-delete 태그는 부분일치·정확 일치 어느 쪽에도 안 나온다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await createTag(prisma, { name: 'cake', deleted_at: new Date() });
      await createTag(prisma, { name: 'cake pop', deleted_at: new Date() });
      await createTags(['cupcake']);

      const result = await service.sellerSearchTags(account.id, {
        keyword: 'cake',
      });
      expect(result.map((r) => r.name)).toEqual(['cupcake']);
      expect(result[0].isExactMatch).toBe(false);
    });

    it('productCount는 삭제 연결·비활성 상품·삭제 상품을 세지 않는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const tag = await createTag(prisma, { name: 'cake' });
      const active = await createProduct(prisma, { store_id: store.id });
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      const deleted = await createProduct(prisma, {
        store_id: store.id,
        deleted_at: new Date(),
      });
      const unlinked = await createProduct(prisma, { store_id: store.id });
      for (const product of [active, inactive, deleted]) {
        await linkProductTag(prisma, { productId: product.id, tagId: tag.id });
      }
      await linkProductTag(prisma, {
        productId: unlinked.id,
        tagId: tag.id,
        deleted_at: new Date(),
      });

      const result = await service.sellerSearchTags(account.id, {
        keyword: 'cake',
      });
      expect(result).toEqual([
        expect.objectContaining({ name: 'cake', productCount: 1 }),
      ]);
    });

    it('limit건까지만 주되 정확 일치는 이름순 limit 밖이어도 맨 앞에 포함한다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await createTags(['a cake', 'b cake', 'c cake', 'cake']);

      const limited = await service.sellerSearchTags(account.id, {
        keyword: 'cake',
        limit: 2,
      });
      expect(limited.map((r) => r.name)).toEqual(['cake', 'a cake']);

      const noExact = await service.sellerSearchTags(account.id, {
        keyword: 'cak',
        limit: 2,
      });
      expect(noExact.map((r) => r.name)).toEqual(['a cake', 'b cake']);
    });

    it('limit을 생략하면 10건', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await createTags(
        Array.from(
          { length: 11 },
          (_, i) => `cake${String(i).padStart(2, '0')}`,
        ),
      );

      const result = await service.sellerSearchTags(account.id, {
        keyword: 'cake',
        limit: null,
      });
      expect(result).toHaveLength(10);
    });

    it('정규화 후 빈 keyword면 DB를 부르지 않고 빈 배열', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await createTags(['cake']);
      const search = jest.spyOn(repository, 'searchTagsByName');

      await expect(
        service.sellerSearchTags(account.id, { keyword: '#' }),
      ).resolves.toEqual([]);
      expect(search).not.toHaveBeenCalled();
    });

    it('정규화 후 80자를 넘으면 400', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSearchTags(account.id, { keyword: 'a'.repeat(81) }),
      ).rejects.toThrowDomain('TEXT_TOO_LONG');
    });

    it('판매자 계정이 아니면 403', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.sellerSearchTags(user.id, { keyword: 'cake' }),
      ).rejects.toThrowDomain(403);
    });
  });
});
