import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserWishlistService } from '@/features/user/services/user-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserWishlistService (real DB)', () => {
  let service: UserWishlistService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserWishlistService, UserRepository, ProductRepository],
    });
    service = module.get(UserWishlistService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupUser() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account;
  }

  // ─── addToWishlist ───
  describe('addToWishlist', () => {
    it('처음 추가 시 wishlistItem row가 생성된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const result = await service.addToWishlist(
        account.id,
        product.id.toString(),
      );

      expect(result).toBe(true);
      const row = await prisma.wishlistItem.findUnique({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row).not.toBeNull();
      expect(row?.deleted_at).toBeNull();
    });

    it('이미 active 상태로 있으면 멱등 (true 반환, 추가 row 없음)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      await service.addToWishlist(account.id, product.id.toString());
      await service.addToWishlist(account.id, product.id.toString());

      const count = await prisma.wishlistItem.count({
        where: { account_id: account.id, product_id: product.id },
      });
      expect(count).toBe(1);
    });

    it('soft-delete된 row가 있으면 deleted_at=null로 복원된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      await prisma.wishlistItem.create({
        data: {
          account_id: account.id,
          product_id: product.id,
          deleted_at: new Date(),
        },
      });

      await service.addToWishlist(account.id, product.id.toString());

      const row = await prisma.wishlistItem.findUnique({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row?.deleted_at).toBeNull();
    });

    it('존재하지 않는 productId면 NotFoundException', async () => {
      const account = await setupUser();
      await expect(service.addToWishlist(account.id, '999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('비활성 product면 NotFoundException', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });

      await expect(
        service.addToWishlist(account.id, product.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete된 product면 NotFoundException', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await prisma.product.update({
        where: { id: product.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.addToWishlist(account.id, product.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('비활성 store에 속한 product면 NotFoundException', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { is_active: false });
      const product = await createProduct(prisma, { store_id: store.id });

      await expect(
        service.addToWishlist(account.id, product.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeFromWishlist ───
  describe('removeFromWishlist', () => {
    it('정상 soft-delete', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await service.addToWishlist(account.id, product.id.toString());

      const result = await service.removeFromWishlist(
        account.id,
        product.id.toString(),
      );

      expect(result).toBe(true);
      const row = await prisma.wishlistItem.findUnique({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row?.deleted_at).not.toBeNull();
    });

    it('이미 없는 상품을 제거해도 멱등 (true 반환)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      const result = await service.removeFromWishlist(
        account.id,
        product.id.toString(),
      );

      expect(result).toBe(true);
    });
  });

  // ─── myWishlist ───
  describe('myWishlist', () => {
    it('자기 찜만 반환 + 추가 시각 desc 정렬', async () => {
      const me = await setupUser();
      const other = await setupUser();
      const store = await createStore(prisma, { store_name: '매장A' });
      const p1 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품1',
      });
      const p2 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품2',
      });

      await service.addToWishlist(me.id, p1.id.toString());
      await new Promise((r) => setTimeout(r, 10));
      await service.addToWishlist(me.id, p2.id.toString());
      await service.addToWishlist(other.id, p1.id.toString());

      const result = await service.myWishlist(me.id);

      expect(result.totalCount).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].productId).toBe(p2.id.toString()); // 최근 추가가 먼저
      expect(result.items[0].productName).toBe('상품2');
      expect(result.items[0].storeName).toBe('매장A');
    });

    it('soft-delete된 wishlist 항목은 제외된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });

      await service.addToWishlist(account.id, product.id.toString());
      await service.removeFromWishlist(account.id, product.id.toString());

      const result = await service.myWishlist(account.id);

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('비활성/삭제된 product는 제외된다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const activeProduct = await createProduct(prisma, { store_id: store.id });
      const inactiveProduct = await createProduct(prisma, {
        store_id: store.id,
      });
      const deletedProduct = await createProduct(prisma, {
        store_id: store.id,
      });

      // active 상태에서 모두 찜 추가
      await prisma.wishlistItem.createMany({
        data: [
          { account_id: account.id, product_id: activeProduct.id },
          { account_id: account.id, product_id: inactiveProduct.id },
          { account_id: account.id, product_id: deletedProduct.id },
        ],
      });
      // 이후 product 상태 변경
      await prisma.product.update({
        where: { id: inactiveProduct.id },
        data: { is_active: false },
      });
      await prisma.product.update({
        where: { id: deletedProduct.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.myWishlist(account.id);

      expect(result.totalCount).toBe(1);
      expect(result.items[0].productId).toBe(activeProduct.id.toString());
    });

    it('페이지네이션이 동작한다 (offset/limit/hasMore)', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      for (let i = 0; i < 5; i++) {
        const p = await createProduct(prisma, { store_id: store.id });
        await service.addToWishlist(account.id, p.id.toString());
      }

      const page1 = await service.myWishlist(account.id, {
        offset: 0,
        limit: 2,
      });
      expect(page1.totalCount).toBe(5);
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.myWishlist(account.id, {
        offset: 4,
        limit: 2,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('offset 음수는 BadRequestException', async () => {
      const account = await setupUser();
      await expect(
        service.myWishlist(account.id, { offset: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('limit이 50 초과면 BadRequestException', async () => {
      const account = await setupUser();
      await expect(
        service.myWishlist(account.id, { limit: 51 }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
