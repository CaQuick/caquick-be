import { BadRequestException } from '@nestjs/common';
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
});
