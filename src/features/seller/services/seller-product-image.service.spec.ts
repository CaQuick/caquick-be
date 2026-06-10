import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductImageService } from '@/features/seller/services/seller-product-image.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerProductImageService (real DB)', () => {
  let service: SellerProductImageService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductImageService,
        SellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerProductImageService);
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

  describe('sellerAddProductImage', () => {
    it('이미지가 이미 5개면 BadRequestException (IMAGE_LIMIT_EXCEEDED)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      for (let i = 1; i <= 4; i++) {
        await prisma.productImage.create({
          data: {
            product_id: product.id,
            image_url: `https://i.example/${i}.png`,
            sort_order: i,
          },
        });
      }

      await expect(
        service.sellerAddProductImage(account.id, {
          productId: product.id.toString(),
          imageUrl: 'https://i.example/6.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 추가', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const result = await service.sellerAddProductImage(account.id, {
        productId: product.id.toString(),
        imageUrl: 'https://i.example/new.png',
      });
      expect(result.imageUrl).toBe('https://i.example/new.png');

      const images = await prisma.productImage.findMany({
        where: { product_id: product.id },
      });
      expect(images).toHaveLength(2);
    });

    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerAddProductImage(account.id, {
          productId: '999999',
          imageUrl: 'https://i.example/x.png',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerDeleteProductImage', () => {
    it('이미지가 최소 1개 제약에 걸리면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const image = await prisma.productImage.findFirstOrThrow({
        where: { product_id: product.id },
      });

      await expect(
        service.sellerDeleteProductImage(account.id, image.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('존재하지 않는 imageId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteProductImage(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장의 이미지면 NotFoundException', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersProduct = await createSellerProduct(other.store.id);
      const othersImage = await prisma.productImage.create({
        data: {
          product_id: othersProduct.id,
          image_url: 'x',
          sort_order: 1,
        },
      });

      await expect(
        service.sellerDeleteProductImage(me.account.id, othersImage.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상 삭제 (이미지 2개 이상)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const extra = await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'x', sort_order: 1 },
      });

      await service.sellerDeleteProductImage(account.id, extra.id);

      const after = await prisma.productImage.findUnique({
        where: { id: extra.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  describe('sellerReorderProductImages', () => {
    it('imageIds 길이가 불일치하면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerReorderProductImages(account.id, {
          productId: product.id.toString(),
          imageIds: ['1', '2', '3'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 재정렬', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const img1 = await prisma.productImage.findFirstOrThrow({
        where: { product_id: product.id },
      });
      const img2 = await prisma.productImage.create({
        data: {
          product_id: product.id,
          image_url: 'https://i.example/b.png',
          sort_order: 1,
        },
      });

      const result = await service.sellerReorderProductImages(account.id, {
        productId: product.id.toString(),
        imageIds: [img2.id.toString(), img1.id.toString()],
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(img2.id.toString());
      expect(result[1].id).toBe(img1.id.toString());
    });

    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerReorderProductImages(account.id, {
          productId: '999999',
          imageIds: ['1'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('매장 imageId 집합과 입력 배열이 안 맞으면 BadRequestException(invalidIds)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const otherProduct = await createSellerProduct(store.id);
      const otherImage = await prisma.productImage.findFirstOrThrow({
        where: { product_id: otherProduct.id },
      });

      await expect(
        service.sellerReorderProductImages(account.id, {
          productId: product.id.toString(),
          imageIds: [otherImage.id.toString()],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
