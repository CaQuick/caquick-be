import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminProductService } from '@/features/admin/services/admin-product.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminProductService (real DB)', () => {
  let service: AdminProductService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminProductService,
        AdminRepository,
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

      const inactive = await service.adminProducts(await admin(), {
        isActive: false,
      });
      expect(inactive.totalCount).toBe(1);
      expect(inactive.items[0].isActive).toBe(false);
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

    it('없거나 삭제된 상품이면 NotFoundException', async () => {
      const deleted = await createProduct(prisma);
      await prisma.product.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });
      await expect(
        service.adminProduct(await admin(), deleted.id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.adminProduct(await admin(), BigInt(999_999)),
      ).rejects.toThrow(NotFoundException);
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

    it('없는 상품이면 NotFoundException', async () => {
      await expect(
        service.adminSetProductActive(await admin(), {
          productId: '999999',
          isActive: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('감사 기록이 실패하면 토글도 롤백된다(같은 트랜잭션)', async () => {
      const product = await createProduct(prisma, { is_active: true });
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'createAuditLog')
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
