import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { ProductAdminRepository } from '@/features/product/repositories/product-admin.repository';
import { AdminProductService } from '@/features/product/services/product-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createCategory,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createTag,
  linkProductCategory,
  linkProductTag,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminProductService (real DB)', () => {
  let service: AdminProductService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminProductService,
        ProductAdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminProductService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  describe('adminProducts', () => {
    it('전체 상품을 최신순으로 매장명과 함께 반환하고 keyword·storeId·isActive 필터가 totalCount에도 적용된다', async () => {
      const storeA = await createStore(prisma, { store_name: 'A샵' });
      const storeB = await createStore(prisma);
      const cake = await createProduct(prisma, {
        store_id: storeA.id,
        name: '딸기 케이크',
      });
      await createProduct(prisma, { store_id: storeB.id, name: '초코 케이크' });
      await createProduct(prisma, {
        store_id: storeB.id,
        name: '비활성 케이크',
        is_active: false,
      });

      const all = await service.adminProducts(await admin());
      expect(all.totalCount).toBe(3);
      expect(all.items[2].storeName).toBe('A샵');

      const byKeyword = await service.adminProducts(await admin(), {
        keyword: '딸기',
      });
      expect(byKeyword.items.map((p) => p.id)).toEqual([cake.id.toString()]);

      const byStore = await service.adminProducts(await admin(), {
        storeId: storeB.id.toString(),
      });
      expect(byStore.totalCount).toBe(2);
      // "0"은 유효한 ID라 조건이 빠지지 않고 빈 결과여야 한다
      expect(
        (await service.adminProducts(await admin(), { storeId: '0' }))
          .totalCount,
      ).toBe(0);

      const inactive = await service.adminProducts(await admin(), {
        isActive: false,
      });
      expect(inactive.totalCount).toBe(1);
      expect(inactive.items[0].isActive).toBe(false);

      // GraphQL nullable 인자에 명시적 null이 오면 필터 없음과 같다
      const nullActive = await service.adminProducts(await admin(), {
        isActive: null,
      });
      expect(nullActive.totalCount).toBe(3);
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정하고 삭제 상품은 제외한다', async () => {
      const store = await createStore(prisma);
      const ids = [
        (await createProduct(prisma, { store_id: store.id })).id,
        (await createProduct(prisma, { store_id: store.id })).id,
        (await createProduct(prisma, { store_id: store.id })).id,
      ];
      const deleted = await createProduct(prisma, { store_id: store.id });
      await prisma.product.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });

      const page1 = await service.adminProducts(await admin(), { limit: 2 });
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminProducts(await admin(), {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((p) => p.id)).toEqual([ids[0].toString()]);
    });
  });

  describe('adminProduct', () => {
    it('매장 상태·이미지(삭제 제외, 순서)·집계(삭제 제외)를 함께 준다', async () => {
      const store = await createStore(prisma, { is_active: false });
      const product = await createProduct(prisma, { store_id: store.id });
      await prisma.productImage.createMany({
        data: [
          {
            product_id: product.id,
            image_url: 'https://i/2.png',
            sort_order: 2,
          },
          {
            product_id: product.id,
            image_url: 'https://i/1.png',
            sort_order: 1,
          },
          {
            product_id: product.id,
            image_url: 'https://i/x.png',
            sort_order: 0,
            deleted_at: new Date(),
          },
        ],
      });
      const item = await createOrderItem(prisma, {
        store_id: store.id,
        product_id: product.id,
      });
      await createReview(prisma, { order_item_id: item.id });

      const result = await service.adminProduct(await admin(), product.id);

      expect(result.product.id).toBe(product.id.toString());
      expect(result.storeIsActive).toBe(false);
      expect(result.imageUrls).toEqual(['https://i/1.png', 'https://i/2.png']);
      expect(result.reviewCount).toBe(1);
      expect(result.orderItemCount).toBe(1);
    });

    it('카테고리는 종류 → 노출 순서로 오고 숨김은 isActive=false로 담고 삭제된 연결·카테고리는 뺀다', async () => {
      const product = await createProduct(prisma);
      const link = async (
        overrides: Parameters<typeof createCategory>[1],
      ): Promise<bigint> => {
        const category = await createCategory(prisma, overrides);
        await linkProductCategory(prisma, {
          productId: product.id,
          categoryId: category.id,
        });
        return category.id;
      };
      // 생성 순서를 기대 순서와 엇갈리게 넣어 정렬이 id 순서에 기대지 않음을 확인한다
      await link({ category_type: 'OTHER', name: '기타', sort_order: 0 });
      await link({ category_type: 'STYLE', name: '레터링', sort_order: 2 });
      await link({
        category_type: 'STYLE',
        name: '숨김 스타일',
        sort_order: 1,
        is_active: false,
      });
      await link({ category_type: 'EVENT', name: '생일', sort_order: 5 });
      await link({
        category_type: 'EVENT',
        name: '삭제된 카테고리',
        deleted_at: new Date(),
      });
      const unlinked = await link({
        category_type: 'EVENT',
        name: '연결 해제',
      });
      await prisma.productCategory.update({
        where: {
          product_id_category_id: {
            product_id: product.id,
            category_id: unlinked,
          },
        },
        data: { deleted_at: new Date() },
      });

      const result = await service.adminProduct(await admin(), product.id);

      expect(
        result.categories.map(({ categoryType, name, isActive }) => [
          categoryType,
          name,
          isActive,
        ]),
      ).toEqual([
        ['EVENT', '생일', true],
        ['STYLE', '숨김 스타일', false],
        ['STYLE', '레터링', true],
        ['OTHER', '기타', true],
      ]);
    });

    it('태그는 이름순으로 오고 삭제된 연결·태그는 뺀다', async () => {
      const product = await createProduct(prisma);
      const link = async (
        name: string,
        opts: { tagDeleted?: boolean; linkDeleted?: boolean } = {},
      ): Promise<void> => {
        const tag = await createTag(prisma, {
          name,
          deleted_at: opts.tagDeleted ? new Date() : null,
        });
        await linkProductTag(prisma, {
          productId: product.id,
          tagId: tag.id,
          deleted_at: opts.linkDeleted ? new Date() : null,
        });
      };
      await link('촉촉');
      await link('달콤');
      await link('삭제된태그', { tagDeleted: true });
      await link('해제된태그', { linkDeleted: true });

      const result = await service.adminProduct(await admin(), product.id);

      expect(result.tags.map((t) => t.name)).toEqual(['달콤', '촉촉']);
    });

    it('옵션 그룹·선택지는 sortOrder 순으로 숨김을 담고 삭제는 빼며 음수 가격 증감과 커스텀 입력 플래그를 그대로 준다', async () => {
      const product = await createProduct(prisma);
      const later = await prisma.productOptionGroup.create({
        data: { product_id: product.id, name: '토핑', sort_order: 2 },
      });
      const first = await prisma.productOptionGroup.create({
        data: {
          product_id: product.id,
          name: '문구',
          sort_order: 1,
          is_required: false,
          min_select: 0,
          max_select: 3,
          is_active: false,
          option_requires_description: true,
          option_requires_image: true,
        },
      });
      await prisma.productOptionGroup.create({
        data: {
          product_id: product.id,
          name: '삭제된 그룹',
          sort_order: 0,
          deleted_at: new Date(),
        },
      });
      await prisma.productOptionItem.createMany({
        data: [
          { option_group_id: later.id, title: '딸기', sort_order: 2 },
          {
            option_group_id: later.id,
            title: '빼기',
            sort_order: 1,
            price_delta: -1000,
            is_active: false,
          },
          {
            option_group_id: later.id,
            title: '삭제된 선택지',
            sort_order: 0,
            deleted_at: new Date(),
          },
        ],
      });

      const result = await service.adminProduct(await admin(), product.id);

      expect(result.optionGroups.map((g) => g.name)).toEqual(['문구', '토핑']);
      expect(result.optionGroups[0]).toMatchObject({
        id: first.id.toString(),
        isRequired: false,
        minSelect: 0,
        maxSelect: 3,
        isActive: false,
        optionRequiresDescription: true,
        optionRequiresImage: true,
        optionItems: [],
      });
      expect(
        result.optionGroups[1].optionItems.map(
          ({ title, priceDelta, isActive }) => [title, priceDelta, isActive],
        ),
      ).toEqual([
        ['빼기', -1000, false],
        ['딸기', 0, true],
      ]);
    });

    it('커스텀 템플릿이 없으면 null이고, 있으면 삭제된 슬롯을 뺀 슬롯을 sortOrder 순으로 준다', async () => {
      const bare = await createProduct(prisma);
      const product = await createProduct(prisma);
      const template = await prisma.productCustomTemplate.create({
        data: {
          product_id: product.id,
          base_image_url: 'https://i/tpl.png',
          is_active: false,
        },
      });
      await prisma.productCustomTextToken.createMany({
        data: [
          {
            template_id: template.id,
            token_key: 'NAME',
            default_text: '이름',
            max_length: 10,
            sort_order: 2,
            is_required: false,
          },
          {
            template_id: template.id,
            token_key: 'MSG',
            default_text: '축하해',
            max_length: 20,
            sort_order: 1,
          },
          {
            template_id: template.id,
            token_key: 'GONE',
            default_text: '삭제',
            sort_order: 0,
            deleted_at: new Date(),
          },
        ],
      });

      expect(
        (await service.adminProduct(await admin(), bare.id)).customTemplate,
      ).toBeNull();
      const result = await service.adminProduct(await admin(), product.id);
      expect(result.customTemplate).toMatchObject({
        id: template.id.toString(),
        baseImageUrl: 'https://i/tpl.png',
        isActive: false,
      });
      expect(
        result.customTemplate?.textTokens.map(
          ({ tokenKey, defaultText, maxLength, isRequired }) => [
            tokenKey,
            defaultText,
            maxLength,
            isRequired,
          ],
        ),
      ).toEqual([
        ['MSG', '축하해', 20, true],
        ['NAME', '이름', 10, false],
      ]);
    });

    it('삭제된 커스텀 템플릿은 null로 준다', async () => {
      const product = await createProduct(prisma);
      await prisma.productCustomTemplate.create({
        data: {
          product_id: product.id,
          base_image_url: 'https://i/tpl.png',
          deleted_at: new Date(),
        },
      });

      const result = await service.adminProduct(await admin(), product.id);

      expect(result.customTemplate).toBeNull();
    });

    it('없거나 삭제된 상품이면 404', async () => {
      const deleted = await createProduct(prisma);
      await prisma.product.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });
      await expect(
        service.adminProduct(await admin(), deleted.id),
      ).rejects.toThrowDomain(404);
      await expect(
        service.adminProduct(await admin(), BigInt(999_999)),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('adminSetProductActive', () => {
    it('노출을 끄고 audit(PRODUCT/STATUS_CHANGE, store_id, reason)을 남긴다', async () => {
      const actor = await admin();
      const product = await createProduct(prisma);

      const result = await service.adminSetProductActive(actor, {
        productId: product.id.toString(),
        isActive: false,
        reason: '정책 위반',
      });

      expect(result.isActive).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'PRODUCT', target_id: product.id },
      });
      expect(audit).toMatchObject({
        actor_account_id: actor,
        store_id: product.store_id,
        action: 'STATUS_CHANGE',
        before_json: { isActive: true },
        after_json: { isActive: false, reason: '정책 위반' },
      });
    });

    it('같은 값이면 그대로 반환하고 audit을 남기지 않는다(멱등)', async () => {
      const product = await createProduct(prisma, { is_active: true });
      const result = await service.adminSetProductActive(await admin(), {
        productId: product.id.toString(),
        isActive: true,
      });
      expect(result.isActive).toBe(true);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('없는 상품이면 404', async () => {
      await expect(
        service.adminSetProductActive(await admin(), {
          productId: '999999',
          isActive: false,
        }),
      ).rejects.toThrowDomain(404);
    });

    it('삭제된 상품은 잠금 단계에서 404(되살리지 않음)', async () => {
      const product = await createProduct(prisma, { is_active: false });
      await prisma.product.update({
        where: { id: product.id },
        data: { deleted_at: new Date() },
      });
      await expect(
        service.adminSetProductActive(await admin(), {
          productId: product.id.toString(),
          isActive: true,
        }),
      ).rejects.toThrowDomain(404);
      const row = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(row.is_active).toBe(false);
    });

    it('두 관리자가 동시에 같은 값으로 토글해도 감사는 1건', async () => {
      const product = await createProduct(prisma, { is_active: true });
      const [a, b] = [await admin(), await admin()];
      await Promise.all([
        service.adminSetProductActive(a, {
          productId: product.id.toString(),
          isActive: false,
        }),
        service.adminSetProductActive(b, {
          productId: product.id.toString(),
          isActive: false,
        }),
      ]);
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'PRODUCT', target_id: product.id },
        }),
      ).toBe(1);
    });

    it('감사 기록이 실패하면 토글도 롤백된다(같은 트랜잭션)', async () => {
      const product = await createProduct(prisma, { is_active: true });
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminSetProductActive(await admin(), {
          productId: product.id.toString(),
          isActive: false,
        }),
      ).rejects.toThrow('audit down');
      const row = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(row.is_active).toBe(true);
      spy.mockRestore();
    });
  });
});
