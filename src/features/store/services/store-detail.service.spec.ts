import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreDetailService } from '@/features/store/services/store-detail.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createReview,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('StoreDetailService (real DB)', () => {
  let service: StoreDetailService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StoreDetailService, StoreRepository, StoreWishlistRepository],
    });
    service = module.get(StoreDetailService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('존재하지 않는 매장은 NotFoundException', async () => {
    await expect(service.storeDetail('999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('비활성 매장은 NotFoundException', async () => {
    const store = await createStore(prisma, { is_active: false });
    await expect(
      service.storeDetail(store.id.toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('잘못된 id 형식은 BadRequestException', async () => {
    await expect(service.storeDetail('abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('매장 헤더와 신규 필드, 이미지(sort_order asc)를 반환한다', async () => {
    const store = await createStore(prisma, {
      store_name: '해즈케이크',
      store_phone: '05930905934',
      address_full: '인천 서구 청라루비로 93',
      address_city: '인천광역시',
      address_neighborhood: '청라동',
      latitude: 37.5,
      longitude: 127.0,
      map_provider: 'NAVER',
      business_hours_text: '10:00AM ~ 19:00PM',
      access_guide_text: '냉삼 꽃삼겹 골목으로 바로 들어오시면 있습니다.',
      regular_closure_text: '매주 2,4주 월요일 쉽니다',
    });
    // sort_order 역순으로 생성 → 결과는 asc 정렬 확인
    await prisma.storeImage.create({
      data: { store_id: store.id, image_url: 'second.png', sort_order: 1 },
    });
    await prisma.storeImage.create({
      data: { store_id: store.id, image_url: 'first.png', sort_order: 0 },
    });

    const result = await service.storeDetail(store.id.toString());

    expect(result).toMatchObject({
      id: store.id.toString(),
      storeName: '해즈케이크',
      phoneNumber: '05930905934',
      addressFull: '인천 서구 청라루비로 93',
      regionLabel: '인천광역시 청라동',
      mapProvider: 'NAVER',
      businessHoursText: '10:00AM ~ 19:00PM',
      accessGuideText: '냉삼 꽃삼겹 골목으로 바로 들어오시면 있습니다.',
      regularClosureText: '매주 2,4주 월요일 쉽니다',
      isWishlisted: false,
    });
    expect(result.images).toEqual(['first.png', 'second.png']);
    expect(result.latitude).toBeCloseTo(37.5);
    expect(result.longitude).toBeCloseTo(127.0);
  });

  it('soft-delete된 이미지는 제외한다', async () => {
    const store = await createStore(prisma);
    await prisma.storeImage.create({
      data: { store_id: store.id, image_url: 'visible.png', sort_order: 0 },
    });
    await prisma.storeImage.create({
      data: {
        store_id: store.id,
        image_url: 'deleted.png',
        sort_order: 1,
        deleted_at: new Date(),
      },
    });

    const result = await service.storeDetail(store.id.toString());

    expect(result.images).toEqual(['visible.png']);
  });

  it('평균 평점(소수 첫째)과 리뷰 수를 집계한다', async () => {
    const store = await createStore(prisma);
    for (const rating of [4, 5]) {
      const orderItem = await createOrderItem(prisma, { store_id: store.id });
      await createReview(prisma, { order_item_id: orderItem.id, rating });
    }

    const result = await service.storeDetail(store.id.toString());

    expect(result.ratingAverage).toBe(4.5);
    expect(result.reviewCount).toBe(2);
  });

  it('리뷰가 없으면 평점 0, 리뷰 수 0', async () => {
    const store = await createStore(prisma);
    const result = await service.storeDetail(store.id.toString());
    expect(result.ratingAverage).toBe(0);
    expect(result.reviewCount).toBe(0);
  });

  it('로그인 사용자의 찜 매장은 isWishlisted=true, 비로그인은 false', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma);
    await createStoreWishlist(prisma, {
      account_id: account.id,
      store_id: store.id,
    });

    const loggedIn = await service.storeDetail(store.id.toString(), account.id);
    expect(loggedIn.isWishlisted).toBe(true);

    const anonymous = await service.storeDetail(store.id.toString());
    expect(anonymous.isWishlisted).toBe(false);
  });
});
