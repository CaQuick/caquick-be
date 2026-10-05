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

  describe('sellerSetProductTagsByName', () => {
    async function setTags(
      accountId: bigint,
      productId: bigint,
      names: string[],
    ) {
      return service.sellerSetProductTagsByName(accountId, {
        productId: productId.toString(),
        names,
      });
    }
    async function activeLinks(productId: bigint) {
      return prisma.productTag.findMany({ where: { product_id: productId } });
    }

    it('존재하지 않는 productId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductTagsByName(account.id, {
          productId: '999999',
          names: ['생일'],
        }),
      ).rejects.toThrowDomain(404);
    });

    it('남의 매장 상품이면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(other.store.id);
      await expect(
        setTags(account.id, product.id, ['생일']),
      ).rejects.toThrowDomain(404);
    });

    it('새 이름은 만들고 기존 이름은 재사용한다 — tag 행은 새 이름 수만큼만 는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const existing = await createTag(prisma, { name: '레터링' });
      const before = await prisma.tag.count();

      const result = await setTags(account.id, product.id, [
        '생일',
        '레터링',
        '기념일',
      ]);
      expect(result.tags.map((t) => t.name).sort()).toEqual([
        '기념일',
        '레터링',
        '생일',
      ]);
      expect(result.tags.find((t) => t.name === '레터링')?.id).toBe(
        existing.id.toString(),
      );
      expect(await prisma.tag.count()).toBe(before + 2);
    });

    it('정규화·중복 제거: 공백·#·대소문자가 다른 같은 이름은 하나로, 소문자로 저장', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const result = await setTags(account.id, product.id, [
        ' #생일 ',
        '생일',
        'BIRTHDAY',
        'birthday',
      ]);
      expect(result.tags.map((t) => t.name).sort()).toEqual([
        'birthday',
        '생일',
      ]);
      expect(
        (await prisma.tag.findMany({ orderBy: { name: 'asc' } })).map(
          (t) => t.name,
        ),
      ).toEqual(['birthday', '생일']);
    });

    it("관리자가 만든 'Cake'가 있을 때 ['cake']는 새 행 없이 그 행에 연결되고 updated_at도 그대로", async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const admin = await createTag(prisma, { name: 'Cake' });

      const result = await setTags(account.id, product.id, ['cake']);
      expect(result.tags).toEqual([{ id: admin.id.toString(), name: 'Cake' }]);
      expect(await prisma.tag.count()).toBe(1);
      const row = await prisma.tag.findUniqueOrThrow({
        where: { id: admin.id },
      });
      expect(row.updated_at).toEqual(admin.updated_at);
    });

    it("대소문자·악센트만 다른 ['café', 'cafe']는 DB 기준 하나로 합쳐 1개만 연결", async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const result = await setTags(account.id, product.id, ['café', 'cafe']);
      expect(result.tags).toHaveLength(1);
      expect(await prisma.tag.count()).toBe(1);
      expect(await activeLinks(product.id)).toHaveLength(1);
    });

    it("soft-delete된 '레터링'은 같은 id가 복구되고 updated_at이 갱신된다", async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const deleted = await createTag(prisma, {
        name: '레터링',
        deleted_at: new Date('2026-01-01T00:00:00Z'),
      });
      await prisma.tag.update({
        where: { id: deleted.id },
        data: { updated_at: new Date('2026-01-01T00:00:00Z') },
      });

      const result = await setTags(account.id, product.id, ['레터링']);
      expect(result.tags).toEqual([
        { id: deleted.id.toString(), name: '레터링' },
      ]);
      const row = await prisma.tag.findUniqueOrThrow({
        where: { id: deleted.id },
      });
      expect(row.deleted_at).toBeNull();
      expect(row.updated_at.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00Z').getTime(),
      );
      expect(await prisma.tag.count()).toBe(1);
    });

    it('빈 배열이면 연결만 전부 해제하고 태그 행은 남는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      await setTags(account.id, product.id, ['생일', '레터링']);

      const result = await setTags(account.id, product.id, []);
      expect(result.tags).toEqual([]);
      expect(await activeLinks(product.id)).toHaveLength(0);
      expect(
        await prisma.productTag.count({
          where: { product_id: product.id, deleted_at: { not: null } },
        }),
      ).toBe(2);
      expect(await prisma.tag.count()).toBe(2);
    });

    it('정규화 후 21개면 400 PRODUCT_TAG_LIMIT_EXCEEDED', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const names = Array.from({ length: 21 }, (_, i) => `t${i}`);
      await expect(
        setTags(account.id, product.id, names),
      ).rejects.toThrowDomain('PRODUCT_TAG_LIMIT_EXCEEDED');
      expect(await prisma.tag.count()).toBe(0);
    });

    it('중복 포함 25개가 정규화 후 20개면 통과', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const names = [
        ...Array.from({ length: 20 }, (_, i) => `t${i}`),
        ...Array.from({ length: 5 }, (_, i) => `#T${i} `),
      ];
      const result = await setTags(account.id, product.id, names);
      expect(result.tags).toHaveLength(20);
    });

    it.each([
      ["['#']", ['#']],
      ["['   ']", ['   ']],
    ])('정규화 후 비는 이름 %s 은 400 TEXT_REQUIRED', async (_label, names) => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      await expect(
        setTags(account.id, product.id, names),
      ).rejects.toThrowDomain('TEXT_REQUIRED');
    });

    it('정규화 전 81자면 400 TEXT_TOO_LONG', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      await expect(
        setTags(account.id, product.id, ['a'.repeat(81)]),
      ).rejects.toThrowDomain('TEXT_TOO_LONG');
    });

    it('같은 입력 2회는 멱등 — 결과·tag 행·활성 연결 수가 그대로', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const names = ['생일', '레터링'];

      const first = await setTags(account.id, product.id, names);
      const second = await setTags(account.id, product.id, names);
      expect(second.tags).toEqual(first.tags);
      expect(await prisma.tag.count()).toBe(2);
      expect(
        await prisma.productTag.count({ where: { deleted_at: undefined } }),
      ).toBe(2);
    });

    it('두 판매자가 같은 새 이름을 동시에 보내도 둘 다 성공하고 tag 행은 1개', async () => {
      const a = await setupSellerWithStore(prisma);
      const b = await setupSellerWithStore(prisma);
      const productA = await createSellerProduct(a.store.id);
      const productB = await createSellerProduct(b.store.id);

      const results = await Promise.allSettled([
        setTags(a.account.id, productA.id, ['동시']),
        setTags(b.account.id, productB.id, ['동시']),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await prisma.tag.count({ where: { name: '동시' } })).toBe(1);
      expect(await activeLinks(productA.id)).toHaveLength(1);
      expect(await activeLinks(productB.id)).toHaveLength(1);
    });

    it('같은 판매자가 같은 상품에 동시 2회 보내면 tag 행 1개·활성 연결 1건이고 둘 다 성공한다(현 동작 기록)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const results = await Promise.allSettled([
        setTags(account.id, product.id, ['동시']),
        setTags(account.id, product.id, ['동시']),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await prisma.tag.count({ where: { name: '동시' } })).toBe(1);
      expect(
        await prisma.productTag.count({ where: { deleted_at: undefined } }),
      ).toBe(1);
    });

    it('감사 로그는 PRODUCT UPDATE 1건이고 afterJson에 tagNames·tagIds가 남는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const result = await setTags(account.id, product.id, ['#생일', '레터링']);
      const auditLogs = await prisma.auditLog.findMany();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]).toMatchObject({
        target_type: 'PRODUCT',
        target_id: product.id,
        action: 'UPDATE',
        actor_account_id: account.id,
      });
      expect(auditLogs[0].after_json).toEqual({
        tagNames: ['생일', '레터링'],
        tagIds: expect.arrayContaining(result.tags.map((t) => t.id)),
      });
    });

    it('판매자 계정이 아니면 403', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.sellerSetProductTagsByName(user.id, {
          productId: '1',
          names: ['생일'],
        }),
      ).rejects.toThrowDomain(403);
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
