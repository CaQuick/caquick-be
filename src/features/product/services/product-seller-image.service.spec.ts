import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { SellerProductImageService } from '@/features/product/services/product-seller-image.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  FOREIGN_UPLOAD_URL,
  ownedUploadUrl,
  s3TestProviders,
} from '@/test/storage/s3-test.helper';

describe('SellerProductImageService (real DB)', () => {
  let service: SellerProductImageService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        SellerProductImageService,
        StoreSellerRepository,
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
    it('이미지가 이미 5개면 400 (PRODUCT_IMAGE_LIMIT_EXCEEDED)', async () => {
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
          imageUrl: ownedUploadUrl('PRODUCT_IMAGE', account.id, '6.png'),
        }),
      ).rejects.toThrowDomain(400);
    });

    it('정상 추가', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      const result = await service.sellerAddProductImage(account.id, {
        productId: product.id.toString(),
        imageUrl: ownedUploadUrl('PRODUCT_IMAGE', account.id, 'new.png'),
      });
      expect(result.imageUrl).toBe(
        ownedUploadUrl('PRODUCT_IMAGE', account.id, 'new.png'),
      );

      const images = await prisma.productImage.findMany({
        where: { product_id: product.id },
      });
      expect(images).toHaveLength(2);
    });

    it('존재하지 않는 productId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerAddProductImage(account.id, {
          productId: '999999',
          imageUrl: ownedUploadUrl('PRODUCT_IMAGE', account.id, 'x.png'),
        }),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('sellerDeleteProductImage', () => {
    it('이미지가 최소 1개 제약에 걸리면 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);
      const image = await prisma.productImage.findFirstOrThrow({
        where: { product_id: product.id },
      });

      await expect(
        service.sellerDeleteProductImage(account.id, image.id),
      ).rejects.toThrowDomain(400);
    });

    it('존재하지 않는 imageId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteProductImage(account.id, BigInt(999999)),
      ).rejects.toThrowDomain(404);
    });

    it('다른 매장의 이미지면 404', async () => {
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
      ).rejects.toThrowDomain(404);
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
    it('imageIds 길이가 불일치하면 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerReorderProductImages(account.id, {
          productId: product.id.toString(),
          imageIds: ['1', '2', '3'],
        }),
      ).rejects.toThrowDomain(400);
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

    it('존재하지 않는 productId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerReorderProductImages(account.id, {
          productId: '999999',
          imageIds: ['1'],
        }),
      ).rejects.toThrowDomain(404);
    });

    it('매장 imageId 집합과 입력 배열이 안 맞으면 400(invalidIds)', async () => {
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
      ).rejects.toThrowDomain(400);
    });
  });

  describe('이미지 URL 소유권', () => {
    const rejected = [
      [
        '타 계정 prefix',
        (id: bigint) => ownedUploadUrl('PRODUCT_IMAGE', id + BigInt(1)),
      ],
      [
        '타 용도(STORE_IMAGE) prefix',
        (id: bigint) => ownedUploadUrl('STORE_IMAGE', id),
      ],
      ['외부 호스트', () => FOREIGN_UPLOAD_URL],
    ] as const;

    it.each(rejected)(
      'sellerAddProductImage.imageUrl이 %s면 BadRequest·이미지 미추가',
      async (_label, url) => {
        const { account, store } = await setupSellerWithStore(prisma);
        const product = await createSellerProduct(store.id);
        await expect(
          service.sellerAddProductImage(account.id, {
            productId: product.id.toString(),
            imageUrl: url(account.id),
          }),
        ).rejects.toThrowDomain('INVALID_IMAGE_URL');
        expect(
          await prisma.productImage.count({
            where: { product_id: product.id },
          }),
        ).toBe(1);
      },
    );
  });
});
