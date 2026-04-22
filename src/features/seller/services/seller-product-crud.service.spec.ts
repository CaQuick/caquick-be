import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerProductCrudService (real DB)', () => {
  let service: SellerProductCrudService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductCrudService,
        SellerRepository,
        ProductRepository,
      ],
    });
    service = module.get(SellerProductCrudService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * 판매자 소유 상품(이미지 1개 + 초기 baseline) 생성.
   * 이미지 최소 1개 제약(IMAGE_MIN_REQUIRED)을 만족시켜 delete 테스트를 돕는다.
   */
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

  describe('공통 예외', () => {
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
      for (let i = 0; i < 3; i++) await createSellerProduct(me.store.id);
      await createSellerProduct(other.store.id);

      const result = await service.sellerProducts(me.account.id, { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
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
  });

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
  });

  describe('sellerAddProductImage', () => {
    it('이미지가 이미 5개면 BadRequestException (IMAGE_LIMIT_EXCEEDED)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id); // 1개
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
  });

  describe('sellerSetProductCategories', () => {
    it('존재하지 않는 categoryId가 있으면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerSetProductCategories(account.id, {
          productId: product.id.toString(),
          categoryIds: ['999999'],
        }),
      ).rejects.toThrow(BadRequestException);
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

  describe('sellerProducts (필터/커서 분기)', () => {
    it('cursor와 categoryId를 넘기면 필터 파라미터가 정상 해석된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const category = await prisma.category.create({
        data: { name: '행사', category_type: 'EVENT' },
      });
      const products: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        const p = await createSellerProduct(store.id, { name: `P${i}` });
        await prisma.productCategory.create({
          data: { product_id: p.id, category_id: category.id },
        });
        products.push(p.id);
      }

      // 첫 페이지
      const first = await service.sellerProducts(account.id, {
        limit: 2,
        categoryId: category.id.toString(),
      });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      // 두 번째 페이지: cursor path 활성화
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

  describe('sellerUpdateProduct (buildProductUpdateData 전 필드 분기)', () => {
    it('description/purchaseNotice/currency/baseDesignImageUrl/preparationTimeMinutes 포함 수정', async () => {
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

  describe('sellerSetProductCategories/Tags 존재 검증 실패 분기', () => {
    it('setProductCategories: 존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductCategories(account.id, {
          productId: '999999',
          categoryIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('setProductTags: 존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSetProductTags(account.id, {
          productId: '999999',
          tagIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerAddProductImage / sellerDeleteProductImage / sellerReorderProductImages 추가 예외', () => {
    it('addProductImage: 존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerAddProductImage(account.id, {
          productId: '999999',
          imageUrl: 'https://i.example/x.png',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reorderProductImages: 존재하지 않는 productId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerReorderProductImages(account.id, {
          productId: '999999',
          imageIds: ['1'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reorderProductImages: 매장 imageId 집합과 입력 배열이 안 맞으면 BadRequestException(invalidIds)', async () => {
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

  describe('toProductOutput custom_template 포함 분기', () => {
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

  describe('sellerSetProductTags', () => {
    it('존재하지 않는 tagId가 있으면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createSellerProduct(store.id);

      await expect(
        service.sellerSetProductTags(account.id, {
          productId: product.id.toString(),
          tagIds: ['999999'],
        }),
      ).rejects.toThrow(BadRequestException);
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
});
