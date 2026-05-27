import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY, AuditLogRepository } from '@/features/audit-log';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductQueryService } from '@/features/seller/services/seller-product-query.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerProductQueryService (real DB)', () => {
  let service: SellerProductQueryService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductQueryService,
        SellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerProductQueryService);
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

  describe('공통 예외 (requireSellerContext)', () => {
    it('계정이 없으면 UnauthorizedException', async () => {
      await expect(
        service.sellerProduct(BigInt(99999), BigInt(1)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('판매자 계정이 아니면 ForbiddenException', async () => {
      const userAccount = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.sellerProduct(userAccount.id, BigInt(1)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sellerProducts', () => {
    it('자기 매장 상품만 반환하고 nextCursor 동작', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const myProducts = await Promise.all([
        createSellerProduct(me.store.id),
        createSellerProduct(me.store.id),
        createSellerProduct(me.store.id),
      ]);
      const othersProduct = await createSellerProduct(other.store.id);

      const result = await service.sellerProducts(me.account.id, { limit: 10 });

      const returnedIds = result.items.map((it) => it.id).sort();
      const myIds = myProducts.map((p) => p.id.toString()).sort();
      expect(returnedIds).toEqual(myIds);
      expect(returnedIds).not.toContain(othersProduct.id.toString());
      expect(result.nextCursor).toBeNull();
    });

    it('limit 페이지네이션은 nextCursor를 반환하고 자기 매장 외 데이터는 노출되지 않는다', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) await createSellerProduct(me.store.id);
      const othersProduct = await createSellerProduct(other.store.id);

      const result = await service.sellerProducts(me.account.id, { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
      expect(result.items.map((it) => it.id)).not.toContain(
        othersProduct.id.toString(),
      );
    });

    it('cursor와 categoryId를 넘기면 필터 파라미터가 정상 해석된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const category = await prisma.category.create({
        data: { name: '행사', category_type: 'EVENT' },
      });
      for (let i = 0; i < 3; i++) {
        const p = await createSellerProduct(store.id, { name: `P${i}` });
        await prisma.productCategory.create({
          data: { product_id: p.id, category_id: category.id },
        });
      }

      const first = await service.sellerProducts(account.id, {
        limit: 2,
        categoryId: category.id.toString(),
      });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.sellerProducts(account.id, {
        limit: 2,
        cursor: first.nextCursor as string,
        categoryId: category.id.toString(),
      });
      expect(second.items.length).toBeGreaterThanOrEqual(1);
    });

    it('search 필터(공백 trim 후 non-empty) 분기도 호출된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createSellerProduct(store.id, { name: '바나나' });
      await createSellerProduct(store.id, { name: '사과' });

      const result = await service.sellerProducts(account.id, {
        search: '  바나나  ',
      });
      expect(result.items.map((i) => i.name)).toContain('바나나');
    });
  });

  describe('sellerProduct', () => {
    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerProduct(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 상품이면 NotFoundException', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersProduct = await createSellerProduct(other.store.id);

      await expect(
        service.sellerProduct(me.account.id, othersProduct.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('본인 상품 상세를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id, {
        name: '바닐라 케이크',
      });

      const result = await service.sellerProduct(account.id, product.id);
      expect(result.id).toBe(product.id.toString());
      expect(result.name).toBe('바닐라 케이크');
      expect(result.images).toHaveLength(1);
    });

    it('custom_template이 존재하는 product 조회 시 customTemplate 필드가 채워진다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id, {
        name: '템플릿 상품',
      });
      await prisma.productCustomTemplate.create({
        data: {
          product_id: product.id,
          base_image_url: 'https://i.example/tpl.png',
          is_active: true,
        },
      });

      const result = await service.sellerProduct(account.id, product.id);
      expect(result.customTemplate).not.toBeNull();
      expect(result.customTemplate?.baseImageUrl).toBe(
        'https://i.example/tpl.png',
      );
    });
  });
});
