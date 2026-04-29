import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createRecentProductView,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const MAX_RECENT_VIEWS = 50;

describe('UserRecentViewService (real DB)', () => {
  let service: UserRecentViewService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserRecentViewService,
        RecentProductViewRepository,
        ProductRepository,
        UserRepository,
      ],
    });

    service = module.get(UserRecentViewService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── list ───
  describe('list', () => {
    it('최근 본 순서로 정렬된 상품 커넥션을 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma, { store_name: '베이커리A' });
      const p1 = await createProduct(prisma, {
        store_id: store.id,
        name: '케이크1',
        regular_price: 10000,
        sale_price: 9000,
      });
      const p2 = await createProduct(prisma, {
        store_id: store.id,
        name: '케이크2',
        regular_price: 20000,
      });

      // p1은 더 이전, p2는 최근에 봄
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: p1.id,
        viewed_at: new Date('2026-04-01'),
      });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: p2.id,
        viewed_at: new Date('2026-04-20'),
      });

      const result = await service.list(account.id);

      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.items).toHaveLength(2);
      // 최근 본 것(p2)이 먼저
      expect(result.items[0]).toMatchObject({
        productId: p2.id.toString(),
        productName: '케이크2',
        storeName: '베이커리A',
        regularPrice: 20000,
      });
      expect(result.items[1].productId).toBe(p1.id.toString());
      expect(result.items[1].salePrice).toBe(9000);
    });

    it('찜한 상품은 isWishlisted=true, 안 한 상품은 false로 매핑된다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      const wishlisted = await createProduct(prisma, { store_id: store.id });
      const notWishlisted = await createProduct(prisma, { store_id: store.id });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: wishlisted.id,
      });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: notWishlisted.id,
      });
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: wishlisted.id },
      });

      const result = await service.list(account.id);

      const map = new Map(
        result.items.map((p) => [p.productId, p.isWishlisted]),
      );
      expect(map.get(wishlisted.id.toString())).toBe(true);
      expect(map.get(notWishlisted.id.toString())).toBe(false);
    });

    it('pagination: offset + limit < totalCount면 hasMore true', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      for (let i = 0; i < 3; i++) {
        const p = await createProduct(prisma, { store_id: store.id });
        await createRecentProductView(prisma, {
          account_id: account.id,
          product_id: p.id,
          viewed_at: new Date(2026, 3, 20 - i),
        });
      }

      const result = await service.list(account.id, { offset: 0, limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('soft-delete된 view는 포함되지 않는다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createRecentProductView(prisma, {
        account_id: account.id,
        deleted_at: new Date(),
      });

      const result = await service.list(account.id);

      expect(result.totalCount).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('is_active=false 상품은 목록에서 제외된다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const inactiveProduct = await createProduct(prisma, { is_active: false });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: inactiveProduct.id,
      });

      const result = await service.list(account.id);

      expect(result.totalCount).toBe(0);
    });

    it('limit이 0 이하면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.list(account.id, { limit: 0 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('limit이 상한(50)을 초과하면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.list(account.id, { limit: 51 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('offset이 음수면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.list(account.id, { offset: -1 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── record ───
  describe('record', () => {
    it('활성 상품이면 view를 새로 기록한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const product = await createProduct(prisma, { is_active: true });

      const result = await service.record(account.id, product.id.toString());

      expect(result).toBe(true);
      const row = await prisma.recentProductView.findUniqueOrThrow({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row.deleted_at).toBeNull();
    });

    it('이미 기록된 view는 viewed_at을 갱신하고 soft-delete를 복원한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const product = await createProduct(prisma, { is_active: true });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: product.id,
        viewed_at: new Date('2025-01-01'),
        deleted_at: new Date('2025-02-01'),
      });

      await service.record(account.id, product.id.toString());

      const row = await prisma.recentProductView.findUniqueOrThrow({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row.deleted_at).toBeNull();
      expect(row.viewed_at.getTime()).toBeGreaterThan(
        new Date('2025-01-01').getTime(),
      );
    });

    it('상품이 존재하지 않으면 NotFoundException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.record(account.id, '999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is_active=false 상품이면 NotFoundException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const inactive = await createProduct(prisma, { is_active: false });

      await expect(
        service.record(account.id, inactive.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효하지 않은 productId 문자열이면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.record(account.id, 'not-a-number')).rejects.toThrow(
        BadRequestException,
      );
    });

    it(`계정당 ${MAX_RECENT_VIEWS}개 초과분은 오래된 순으로 soft-delete된다`, async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      // 먼저 50개 기록 (오래된 순)
      const existingProductIds: bigint[] = [];
      for (let i = 0; i < MAX_RECENT_VIEWS; i++) {
        const p = await createProduct(prisma, { store_id: store.id });
        existingProductIds.push(p.id);
        await createRecentProductView(prisma, {
          account_id: account.id,
          product_id: p.id,
          // 오름차순 시간: i=0이 가장 오래됨
          viewed_at: new Date(2026, 0, 1, 0, i),
        });
      }

      // 51번째 상품 기록 → oldest 1개가 soft-delete 되어야 함
      const newProduct = await createProduct(prisma, { store_id: store.id });
      await service.record(account.id, newProduct.id.toString());

      const activeCount = await prisma.recentProductView.count({
        where: { account_id: account.id, deleted_at: null },
      });
      expect(activeCount).toBe(MAX_RECENT_VIEWS);

      // 가장 오래된 것(인덱스 0)이 soft-delete 되었는지 확인
      const oldest = await prisma.recentProductView.findUniqueOrThrow({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: existingProductIds[0],
          },
        },
      });
      expect(oldest.deleted_at).not.toBeNull();
    });
  });

  // ─── deleteOne ───
  describe('deleteOne', () => {
    it('기록이 있으면 soft-delete하고 true를 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const product = await createProduct(prisma);
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: product.id,
      });

      const result = await service.deleteOne(account.id, product.id.toString());

      expect(result).toBe(true);
      const row = await prisma.recentProductView.findUniqueOrThrow({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row.deleted_at).not.toBeNull();
    });

    it('존재하지 않는 (또는 이미 삭제된) 항목이면 false', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const result = await service.deleteOne(account.id, '999999');
      expect(result).toBe(false);
    });

    it('유효하지 않은 productId 문자열이면 BadRequestException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.deleteOne(account.id, 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── clearAll ───
  describe('clearAll', () => {
    it('해당 계정의 모든 active view를 soft-delete한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      for (let i = 0; i < 3; i++) {
        await createRecentProductView(prisma, { account_id: account.id });
      }

      const result = await service.clearAll(account.id);

      expect(result).toBe(true);
      const activeCount = await prisma.recentProductView.count({
        where: { account_id: account.id, deleted_at: null },
      });
      expect(activeCount).toBe(0);
    });

    it('삭제할 항목이 없어도 true를 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const result = await service.clearAll(account.id);
      expect(result).toBe(true);
    });

    it('다른 계정의 view는 영향을 받지 않는다', async () => {
      const a1 = await createAccount(prisma, { account_type: 'USER' });
      const a2 = await createAccount(prisma, { account_type: 'USER' });
      await createRecentProductView(prisma, { account_id: a1.id });
      await createRecentProductView(prisma, { account_id: a2.id });

      await service.clearAll(a1.id);

      const a2Remaining = await prisma.recentProductView.count({
        where: { account_id: a2.id, deleted_at: null },
      });
      expect(a2Remaining).toBe(1);
    });
  });
});
