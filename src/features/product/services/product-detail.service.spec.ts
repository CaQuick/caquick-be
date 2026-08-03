import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
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

describe('ProductDetailService (real DB)', () => {
  let service: ProductDetailService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductDetailService, ProductRepository],
    });
    service = module.get(ProductDetailService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('존재하지 않는 상품은 NotFoundException', async () => {
    await expect(service.productDetail('999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('비활성 상품은 NotFoundException', async () => {
    const product = await createProduct(prisma, { is_active: false });
    await expect(
      service.productDetail(product.id.toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('비활성 매장의 상품은 NotFoundException', async () => {
    const store = await createStore(prisma, { is_active: false });
    const product = await createProduct(prisma, { store_id: store.id });
    await expect(
      service.productDetail(product.id.toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('잘못된 id 형식은 BadRequestException', async () => {
    await expect(service.productDetail('abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('상세 필드·할인율·이미지(sort_order asc)를 반환한다', async () => {
    const product = await createProduct(prisma, {
      name: '그림일기 케이크',
      description: '설명 텍스트',
      regular_price: 35000,
      sale_price: 33000,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { purchase_notice: '픽업 후 이동 중 케이크가 흔들릴 수 있습니다.' },
    });
    // sort_order 역순 생성 → asc 정렬 확인
    await prisma.productImage.create({
      data: { product_id: product.id, image_url: 'second.png', sort_order: 1 },
    });
    await prisma.productImage.create({
      data: { product_id: product.id, image_url: 'first.png', sort_order: 0 },
    });
    await prisma.productImage.create({
      data: {
        product_id: product.id,
        image_url: 'deleted.png',
        sort_order: 2,
        deleted_at: new Date(),
      },
    });

    const result = await service.productDetail(product.id.toString());

    expect(result).toMatchObject({
      id: product.id.toString(),
      storeId: product.store_id.toString(),
      name: '그림일기 케이크',
      description: '설명 텍스트',
      purchaseNotice: '픽업 후 이동 중 케이크가 흔들릴 수 있습니다.',
      regularPrice: 35000,
      salePrice: 33000,
      // (1 - 33000/35000) * 100 ≈ 5.71 → 반올림 6
      discountRate: 6,
      currency: 'KRW',
      isWishlisted: false,
      reviewCount: 0,
    });
    expect(result.images).toEqual(['first.png', 'second.png']);
  });

  it('옵션 그룹/아이템은 활성만 sort_order asc로 반환하고 그룹 설명을 포함한다', async () => {
    const product = await createProduct(prisma);
    const flavorGroup = await prisma.productOptionGroup.create({
      data: {
        product_id: product.id,
        name: '케이크 맛 옵션',
        description: '동구리 특제 크림으로 제작됩니다.',
        sort_order: 1,
      },
    });
    await prisma.productOptionGroup.create({
      data: { product_id: product.id, name: '케이크 사이즈', sort_order: 0 },
    });
    await prisma.productOptionGroup.create({
      data: {
        product_id: product.id,
        name: '비활성 그룹',
        sort_order: 2,
        is_active: false,
      },
    });
    await prisma.productOptionItem.create({
      data: {
        option_group_id: flavorGroup.id,
        title: '고구마 100프로',
        description: '바닐라빈 시트 + 고구마크림',
        price_delta: 2000,
        sort_order: 1,
      },
    });
    await prisma.productOptionItem.create({
      data: { option_group_id: flavorGroup.id, title: '기본', sort_order: 0 },
    });
    await prisma.productOptionItem.create({
      data: {
        option_group_id: flavorGroup.id,
        title: '삭제된 항목',
        sort_order: 2,
        deleted_at: new Date(),
      },
    });

    const result = await service.productDetail(product.id.toString());

    expect(result.optionGroups.map((g) => g.name)).toEqual([
      '케이크 사이즈',
      '케이크 맛 옵션',
    ]);
    const flavor = result.optionGroups[1];
    expect(flavor.description).toBe('동구리 특제 크림으로 제작됩니다.');
    expect(flavor.items.map((item) => item.title)).toEqual([
      '기본',
      '고구마 100프로',
    ]);
    expect(flavor.items[1].priceDelta).toBe(2000);
  });

  it('리뷰 수를 집계하고 soft-delete 리뷰는 제외한다', async () => {
    const product = await createProduct(prisma);
    const orderItem1 = await createOrderItem(prisma, {
      product_id: product.id,
    });
    await createReview(prisma, { order_item_id: orderItem1.id });
    const orderItem2 = await createOrderItem(prisma, {
      product_id: product.id,
    });
    const deletedReview = await createReview(prisma, {
      order_item_id: orderItem2.id,
    });
    await prisma.review.update({
      where: { id: deletedReview.id },
      data: { deleted_at: new Date() },
    });

    const result = await service.productDetail(product.id.toString());

    expect(result.reviewCount).toBe(1);
  });

  it('로그인 사용자의 찜 상품은 isWishlisted=true, 찜 해제(soft-delete)면 false', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const product = await createProduct(prisma);
    await prisma.wishlistItem.create({
      data: { account_id: account.id, product_id: product.id },
    });

    const loggedIn = await service.productDetail(
      product.id.toString(),
      account.id,
    );
    expect(loggedIn.isWishlisted).toBe(true);

    const anonymous = await service.productDetail(product.id.toString());
    expect(anonymous.isWishlisted).toBe(false);

    await prisma.wishlistItem.updateMany({
      where: { account_id: account.id, product_id: product.id },
      data: { deleted_at: new Date() },
    });
    const afterRemoval = await service.productDetail(
      product.id.toString(),
      account.id,
    );
    expect(afterRemoval.isWishlisted).toBe(false);
  });
});
