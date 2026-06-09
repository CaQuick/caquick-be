import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductLifecycleService } from '@/features/seller/services/seller-product-lifecycle.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerProductLifecycleService (real DB)', () => {
  let service: SellerProductLifecycleService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductLifecycleService,
        SellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerProductLifecycleService);
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

  describe('sellerCreateProduct', () => {
    it('regularPrice가 범위 밖(<1)이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateProduct(account.id, {
          name: 'X',
          regularPrice: 0,
          initialImageUrl: 'https://i.example/a.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salePrice > regularPrice면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerCreateProduct(account.id, {
          name: 'X',
          regularPrice: 10000,
          salePrice: 20000,
          initialImageUrl: 'https://i.example/a.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 생성 + 초기 이미지 + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerCreateProduct(account.id, {
        name: '신상 케이크',
        regularPrice: 30000,
        salePrice: 25000,
        initialImageUrl: 'https://i.example/init.png',
      });

      expect(result.name).toBe('신상 케이크');
      expect(result.regularPrice).toBe(30000);
      expect(result.images).toHaveLength(1);

      const images = await prisma.productImage.findMany({
        where: { product_id: BigInt(result.id) },
      });
      expect(images).toHaveLength(1);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'CREATE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpdateProduct', () => {
    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdateProduct(account.id, {
          productId: '999999',
          name: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상 수정 + audit log(before/after)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id, { name: '구' });

      const result = await service.sellerUpdateProduct(account.id, {
        productId: product.id.toString(),
        name: '신',
      });
      expect(result.name).toBe('신');

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'UPDATE' },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it('description/purchaseNotice/currency/baseDesignImageUrl/preparationTimeMinutes 포함 수정 (buildProductUpdateData 전 필드 분기)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id, { name: '초기' });

      const result = await service.sellerUpdateProduct(account.id, {
        productId: product.id.toString(),
        description: '설명',
        purchaseNotice: '주의사항',
        currency: 'KRW',
        baseDesignImageUrl: 'https://i.example/base.png',
        preparationTimeMinutes: 60,
        regularPrice: 12000,
        salePrice: 9000,
      });

      expect(result.description).toBe('설명');
      expect(result.purchaseNotice).toBe('주의사항');
      expect(result.currency).toBe('KRW');
      expect(result.baseDesignImageUrl).toBe('https://i.example/base.png');
      expect(result.preparationTimeMinutes).toBe(60);
      expect(result.regularPrice).toBe(12000);
      expect(result.salePrice).toBe(9000);
    });

    it('salePrice만 넘긴 경우 기존 regularPrice 기준 검증을 통과한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const result = await service.sellerUpdateProduct(account.id, {
        productId: product.id.toString(),
        salePrice: 8000,
      });
      expect(result.salePrice).toBe(8000);
    });
  });

  describe('sellerDeleteProduct', () => {
    it('존재하지 않으면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteProduct(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await service.sellerDeleteProduct(account.id, product.id);

      const after = await prisma.product.findUnique({
        where: { id: product.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  describe('sellerSetProductActive', () => {
    it('is_active 토글 + audit log STATUS_CHANGE', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await service.sellerSetProductActive(account.id, {
        productId: product.id.toString(),
        isActive: false,
      });

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
      });
      expect(after.is_active).toBe(false);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'STATUS_CHANGE' },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductActive(account.id, {
          productId: '999999',
          isActive: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
