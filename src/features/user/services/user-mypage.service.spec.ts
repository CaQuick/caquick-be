import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserMypageService } from '@/features/user/services/user-mypage.service';

describe('UserMypageService', () => {
  let service: UserMypageService;
  let userRepo: jest.Mocked<UserRepository>;
  let orderRepo: jest.Mocked<OrderRepository>;
  let recentViewRepo: jest.Mocked<RecentProductViewRepository>;

  const accountId = BigInt(1);

  beforeEach(async () => {
    userRepo = {
      countCustomDrafts: jest.fn(),
      countWishlistItems: jest.fn(),
      countMyReviews: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    orderRepo = {
      findOngoingOrdersByAccount: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;

    recentViewRepo = {
      findRecentByAccount: jest.fn(),
    } as unknown as jest.Mocked<RecentProductViewRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserMypageService,
        { provide: UserRepository, useValue: userRepo },
        { provide: OrderRepository, useValue: orderRepo },
        { provide: RecentProductViewRepository, useValue: recentViewRepo },
      ],
    }).compile();

    service = module.get<UserMypageService>(UserMypageService);
  });

  it('모든 카운트와 리스트를 집계하여 반환해야 한다', async () => {
    userRepo.countCustomDrafts.mockResolvedValue(3);
    userRepo.countWishlistItems.mockResolvedValue(5);
    userRepo.countMyReviews.mockResolvedValue(2);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    const result = await service.getOverview(accountId);

    expect(result.counts).toEqual({
      customDraftCount: 3,
      couponCount: 0,
      wishlistCount: 5,
      myReviewCount: 2,
    });
    expect(result.ongoingOrders).toEqual([]);
    expect(result.recentViewedProducts).toEqual([]);
  });

  it('couponCount는 항상 0이어야 한다 (MVP 스텁)', async () => {
    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    const result = await service.getOverview(accountId);

    expect(result.counts.couponCount).toBe(0);
  });

  it('진행중인 주문이 있으면 대표 상품명과 이미지를 포함해야 한다', async () => {
    const mockOrder = {
      id: BigInt(100),
      order_number: 'CQ-20260413-00001',
      status: OrderStatus.SUBMITTED,
      created_at: new Date('2026-04-10'),
      pickup_at: new Date('2026-04-15'),
      total_price: 35000,
      items: [
        {
          product_name_snapshot: '딸기 케이크',
          product: {
            images: [{ image_url: 'https://s3.example.com/cake.jpg' }],
          },
        },
      ],
    };

    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([mockOrder]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    const result = await service.getOverview(accountId);

    expect(result.ongoingOrders).toHaveLength(1);
    expect(result.ongoingOrders[0]).toMatchObject({
      orderId: '100',
      orderNumber: 'CQ-20260413-00001',
      status: OrderStatus.SUBMITTED,
      representativeProductName: '딸기 케이크',
      representativeProductImageUrl: 'https://s3.example.com/cake.jpg',
      totalPrice: 35000,
    });
  });

  it('주문 아이템에 이미지가 없으면 null을 반환해야 한다', async () => {
    const mockOrder = {
      id: BigInt(101),
      order_number: 'CQ-20260413-00002',
      status: OrderStatus.CONFIRMED,
      created_at: new Date('2026-04-10'),
      pickup_at: new Date('2026-04-15'),
      total_price: 20000,
      items: [
        {
          product_name_snapshot: '초코 케이크',
          product: { images: [] },
        },
      ],
    };

    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([mockOrder]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    const result = await service.getOverview(accountId);

    expect(result.ongoingOrders[0].representativeProductImageUrl).toBeNull();
  });

  it('최근 본 상품을 올바르게 매핑해야 한다', async () => {
    const mockView = {
      product_id: BigInt(200),
      viewed_at: new Date('2026-04-12'),
      product: {
        name: '레터링 케이크',
        regular_price: 45000,
        sale_price: 40000,
        store: { store_name: '스웨이드 베이커리' },
        images: [{ image_url: 'https://s3.example.com/lettering.jpg' }],
      },
    };

    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([mockView]);

    const result = await service.getOverview(accountId);

    expect(result.recentViewedProducts).toHaveLength(1);
    expect(result.recentViewedProducts[0]).toMatchObject({
      productId: '200',
      productName: '레터링 케이크',
      representativeImageUrl: 'https://s3.example.com/lettering.jpg',
      salePrice: 40000,
      regularPrice: 45000,
      storeName: '스웨이드 베이커리',
    });
  });

  it('진행중 주문 조회 시 최근 90일 기준 since를 전달해야 한다', async () => {
    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    jest.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });

    await service.getOverview(accountId);

    const callArgs = orderRepo.findOngoingOrdersByAccount.mock.calls[0][0];
    expect(callArgs.accountId).toBe(accountId);
    expect(callArgs.limit).toBe(5);

    const expectedSince = new Date('2026-01-13T00:00:00Z');
    expect(callArgs.since.getTime()).toBe(expectedSince.getTime());

    jest.useRealTimers();
  });

  it('주문에 items가 비어있으면 기본값을 반환해야 한다', async () => {
    const mockOrder = {
      id: BigInt(102),
      order_number: 'CQ-00002',
      status: OrderStatus.SUBMITTED,
      created_at: new Date('2026-04-10'),
      pickup_at: new Date('2026-04-15'),
      total_price: 0,
      items: [],
    };

    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([mockOrder]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    const result = await service.getOverview(accountId);

    expect(result.ongoingOrders[0].representativeProductName).toBe(
      '상품 정보 없음',
    );
    expect(result.ongoingOrders[0].representativeProductImageUrl).toBeNull();
  });

  it('최근 본 상품에 이미지가 없으면 null을 반환해야 한다', async () => {
    const mockView = {
      product_id: BigInt(201),
      viewed_at: new Date('2026-04-12'),
      product: {
        name: '무이미지 케이크',
        regular_price: 30000,
        sale_price: null,
        store: { store_name: '테스트 베이커리' },
        images: [],
      },
    };

    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([mockView]);

    const result = await service.getOverview(accountId);

    expect(result.recentViewedProducts[0].representativeImageUrl).toBeNull();
    expect(result.recentViewedProducts[0].salePrice).toBeNull();
  });

  it('모든 카운트가 0이고 리스트가 비어있어도 정상 반환해야 한다', async () => {
    userRepo.countCustomDrafts.mockResolvedValue(0);
    userRepo.countWishlistItems.mockResolvedValue(0);
    userRepo.countMyReviews.mockResolvedValue(0);
    orderRepo.findOngoingOrdersByAccount.mockResolvedValue([]);
    recentViewRepo.findRecentByAccount.mockResolvedValue([]);

    const result = await service.getOverview(accountId);

    expect(result.counts.customDraftCount).toBe(0);
    expect(result.counts.wishlistCount).toBe(0);
    expect(result.counts.myReviewCount).toBe(0);
    expect(result.counts.couponCount).toBe(0);
    expect(result.ongoingOrders).toHaveLength(0);
    expect(result.recentViewedProducts).toHaveLength(0);
  });
});
