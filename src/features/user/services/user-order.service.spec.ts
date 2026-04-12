import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { USER_ORDER_ERRORS } from '@/features/user/constants/user-order-error-messages';
import { UserOrderService } from '@/features/user/services/user-order.service';

describe('UserOrderService', () => {
  let service: UserOrderService;
  let orderRepo: jest.Mocked<OrderRepository>;

  const accountId = BigInt(1);

  const makeMockOrder = (overrides: {
    id?: bigint;
    status?: OrderStatus;
    storeName?: string;
    productName?: string;
    imageUrl?: string | null;
    itemCount?: number;
  }) => ({
    id: overrides.id ?? BigInt(100),
    order_number: 'CQ-20260413-00001',
    status: overrides.status ?? OrderStatus.SUBMITTED,
    created_at: new Date('2026-04-10'),
    pickup_at: new Date('2026-04-15'),
    total_price: 35000,
    items: [
      {
        product_name_snapshot: overrides.productName ?? '딸기 케이크',
        store: { store_name: overrides.storeName ?? '스웨이드 베이커리' },
        product: {
          images:
            overrides.imageUrl !== null
              ? [
                  {
                    image_url:
                      overrides.imageUrl ?? 'https://s3.example.com/cake.jpg',
                  },
                ]
              : [],
        },
      },
    ],
    _count: { items: overrides.itemCount ?? 1 },
  });

  beforeEach(async () => {
    orderRepo = {
      findOrdersByAccount: jest.fn(),
      countOrdersByAccount: jest.fn(),
      findOrderDetailByAccount: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserOrderService,
        { provide: OrderRepository, useValue: orderRepo },
      ],
    }).compile();

    service = module.get<UserOrderService>(UserOrderService);
  });

  it('기본 입력으로 주문 목록을 반환해야 한다', async () => {
    const mockOrder = makeMockOrder({});
    orderRepo.findOrdersByAccount.mockResolvedValue([mockOrder]);
    orderRepo.countOrdersByAccount.mockResolvedValue(1);

    const result = await service.listMyOrders(accountId);

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.items[0]).toMatchObject({
      orderId: '100',
      orderNumber: 'CQ-20260413-00001',
      status: OrderStatus.SUBMITTED,
      representativeProductName: '딸기 케이크',
      representativeProductImageUrl: 'https://s3.example.com/cake.jpg',
      storeName: '스웨이드 베이커리',
      totalPrice: 35000,
      additionalItemCount: 0,
    });
  });

  it('상태 필터가 전달되면 repository에 전달해야 한다', async () => {
    orderRepo.findOrdersByAccount.mockResolvedValue([]);
    orderRepo.countOrdersByAccount.mockResolvedValue(0);

    await service.listMyOrders(accountId, {
      statuses: [OrderStatus.SUBMITTED, OrderStatus.CONFIRMED],
      offset: 0,
      limit: 20,
    });

    expect(orderRepo.findOrdersByAccount).toHaveBeenCalledWith({
      accountId,
      statuses: [OrderStatus.SUBMITTED, OrderStatus.CONFIRMED],
      offset: 0,
      limit: 21,
    });
    expect(orderRepo.countOrdersByAccount).toHaveBeenCalledWith({
      accountId,
      statuses: [OrderStatus.SUBMITTED, OrderStatus.CONFIRMED],
    });
  });

  it('limit+1개가 반환되면 hasMore가 true여야 한다', async () => {
    const orders = Array.from({ length: 21 }, (_, i) =>
      makeMockOrder({ id: BigInt(i + 1) }),
    );
    orderRepo.findOrdersByAccount.mockResolvedValue(orders);
    orderRepo.countOrdersByAccount.mockResolvedValue(25);

    const result = await service.listMyOrders(accountId, { limit: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(25);
  });

  it('limit 미만이면 hasMore가 false여야 한다', async () => {
    orderRepo.findOrdersByAccount.mockResolvedValue([makeMockOrder({})]);
    orderRepo.countOrdersByAccount.mockResolvedValue(1);

    const result = await service.listMyOrders(accountId, { limit: 20 });

    expect(result.hasMore).toBe(false);
  });

  it('additionalItemCount는 전체 아이템 수 - 1이어야 한다', async () => {
    const mockOrder = makeMockOrder({ itemCount: 3 });
    orderRepo.findOrdersByAccount.mockResolvedValue([mockOrder]);
    orderRepo.countOrdersByAccount.mockResolvedValue(1);

    const result = await service.listMyOrders(accountId);

    expect(result.items[0].additionalItemCount).toBe(2);
  });

  it('이미지가 없으면 representativeProductImageUrl이 null이어야 한다', async () => {
    const mockOrder = makeMockOrder({ imageUrl: null });
    orderRepo.findOrdersByAccount.mockResolvedValue([mockOrder]);
    orderRepo.countOrdersByAccount.mockResolvedValue(1);

    const result = await service.listMyOrders(accountId);

    expect(result.items[0].representativeProductImageUrl).toBeNull();
  });

  it('빈 목록도 정상 반환해야 한다', async () => {
    orderRepo.findOrdersByAccount.mockResolvedValue([]);
    orderRepo.countOrdersByAccount.mockResolvedValue(0);

    const result = await service.listMyOrders(accountId);

    expect(result.items).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('limit이 50 초과이면 에러를 던져야 한다', async () => {
    await expect(
      service.listMyOrders(accountId, { limit: 51 }),
    ).rejects.toThrow(USER_ORDER_ERRORS.INVALID_LIMIT);
  });

  it('limit이 0이면 에러를 던져야 한다', async () => {
    await expect(service.listMyOrders(accountId, { limit: 0 })).rejects.toThrow(
      USER_ORDER_ERRORS.INVALID_LIMIT,
    );
  });

  it('offset이 음수이면 에러를 던져야 한다', async () => {
    await expect(
      service.listMyOrders(accountId, { offset: -1 }),
    ).rejects.toThrow(USER_ORDER_ERRORS.INVALID_OFFSET);
  });

  describe('getMyOrder', () => {
    const makeDetailOrder = (overrides?: {
      status?: OrderStatus;
      hasReview?: boolean;
      reviewDeleted?: boolean;
    }) => ({
      id: BigInt(100),
      order_number: 'CQ-20260413-00001',
      account_id: accountId,
      status: overrides?.status ?? OrderStatus.PICKED_UP,
      created_at: new Date('2026-04-10'),
      pickup_at: new Date('2026-04-15'),
      buyer_name: '홍길동',
      buyer_phone: '010-1234-5678',
      subtotal_price: 35000,
      discount_price: 0,
      total_price: 35000,
      submitted_at: new Date('2026-04-10'),
      confirmed_at: new Date('2026-04-11'),
      made_at: new Date('2026-04-14'),
      picked_up_at: new Date('2026-04-15'),
      canceled_at: null,
      status_histories: [
        {
          from_status: null,
          to_status: OrderStatus.SUBMITTED,
          changed_at: new Date('2026-04-10'),
          note: null,
        },
      ],
      items: [
        {
          id: BigInt(200),
          product_id: BigInt(300),
          product_name_snapshot: '딸기 케이크',
          regular_price_snapshot: 35000,
          sale_price_snapshot: null,
          quantity: 1,
          item_subtotal_price: 35000,
          store: {
            id: BigInt(10),
            store_name: '스웨이드 베이커리',
            store_phone: '0507-1449-4422',
            address_full: '서울 강남구 도산대로62길 26 1층',
            address_city: '서울',
            address_district: '강남구',
            address_neighborhood: '신사동',
            latitude: { toNumber: () => 37.5228 } as unknown,
            longitude: { toNumber: () => 127.0236 } as unknown,
            business_hours_text: '매일 09:00 ~ 18:00',
            website_url: 'https://suede.co.kr',
            business_hours: [],
          },
          product: {
            images: [{ image_url: 'https://s3.example.com/cake.jpg' }],
          },
          option_items: [
            {
              group_name_snapshot: '사이즈',
              option_title_snapshot: '2호',
              option_price_delta_snapshot: 5000,
            },
          ],
          custom_texts: [],
          free_edits: [],
          review: overrides?.hasReview
            ? {
                id: BigInt(1),
                deleted_at: overrides?.reviewDeleted
                  ? new Date('2026-04-12')
                  : null,
              }
            : null,
        },
      ],
    });

    it('주문 상세를 반환해야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(
        makeDetailOrder() as never,
      );

      const result = await service.getMyOrder(accountId, BigInt(100));

      expect(result.orderId).toBe('100');
      expect(result.orderNumber).toBe('CQ-20260413-00001');
      expect(result.buyerName).toBe('홍길동');
      expect(result.store.storeName).toBe('스웨이드 베이커리');
      expect(result.store.addressFull).toBe('서울 강남구 도산대로62길 26 1층');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].selectedOptions).toHaveLength(1);
      expect(result.items[0].selectedOptions[0].groupName).toBe('사이즈');
    });

    it('주문이 없으면 NotFoundException을 던져야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(null);

      await expect(service.getMyOrder(accountId, BigInt(999))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('PICKED_UP 상태이고 리뷰가 없으면 canWriteReview가 true여야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(
        makeDetailOrder({
          status: OrderStatus.PICKED_UP,
          hasReview: false,
        }) as never,
      );

      const result = await service.getMyOrder(accountId, BigInt(100));

      expect(result.items[0].canWriteReview).toBe(true);
      expect(result.items[0].hasMyReview).toBe(false);
    });

    it('리뷰가 이미 있으면 canWriteReview가 false여야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(
        makeDetailOrder({
          status: OrderStatus.PICKED_UP,
          hasReview: true,
        }) as never,
      );

      const result = await service.getMyOrder(accountId, BigInt(100));

      expect(result.items[0].canWriteReview).toBe(false);
      expect(result.items[0].hasMyReview).toBe(true);
    });

    it('soft-delete된 리뷰가 있으면 canWriteReview가 true여야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(
        makeDetailOrder({
          status: OrderStatus.PICKED_UP,
          hasReview: true,
          reviewDeleted: true,
        }) as never,
      );

      const result = await service.getMyOrder(accountId, BigInt(100));

      expect(result.items[0].canWriteReview).toBe(true);
      expect(result.items[0].hasMyReview).toBe(false);
    });

    it('PICKED_UP이 아닌 상태면 canWriteReview가 false여야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(
        makeDetailOrder({ status: OrderStatus.CONFIRMED }) as never,
      );

      const result = await service.getMyOrder(accountId, BigInt(100));

      expect(result.items[0].canWriteReview).toBe(false);
    });

    it('상태 히스토리를 올바르게 매핑해야 한다', async () => {
      orderRepo.findOrderDetailByAccount.mockResolvedValue(
        makeDetailOrder() as never,
      );

      const result = await service.getMyOrder(accountId, BigInt(100));

      expect(result.statusHistories).toHaveLength(1);
      expect(result.statusHistories[0].toStatus).toBe(OrderStatus.SUBMITTED);
    });
  });
});
