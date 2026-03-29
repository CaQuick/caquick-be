import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';

import {
  OrderDomainService,
  OrderRepository,
  OrderStatusTransitionPolicy,
} from '@/features/order';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';

describe('SellerOrderService', () => {
  let service: SellerOrderService;
  let repo: jest.Mocked<SellerRepository>;
  let orderRepo: jest.Mocked<OrderRepository>;

  const SELLER_CONTEXT = {
    id: BigInt(1),
    account_type: 'SELLER',
    status: 'ACTIVE',
    store: { id: BigInt(100) },
  };

  const NOW = new Date('2026-03-30T00:00:00.000Z');

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;
    orderRepo = {
      listOrdersByStore: jest.fn(),
      findOrderDetailByStore: jest.fn(),
      updateOrderStatusBySeller: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerOrderService,
        OrderStatusTransitionPolicy,
        OrderDomainService,
        {
          provide: SellerRepository,
          useValue: repo,
        },
        {
          provide: OrderRepository,
          useValue: orderRepo,
        },
      ],
    }).compile();

    service = module.get<SellerOrderService>(SellerOrderService);
  });

  // ─── 기존 예외 테스트 ────────────────────────────────────────

  it('판매자 계정이 아니면 ForbiddenException을 던져야 한다', async () => {
    repo.findSellerAccountContext.mockResolvedValue({
      id: BigInt(1),
      account_type: 'USER',
      status: 'ACTIVE',
      store: { id: BigInt(100) },
    } as never);

    await expect(service.sellerOrder(BigInt(1), BigInt(10))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('주문 상태 전이가 잘못되면 BadRequestException을 던져야 한다', async () => {
    repo.findSellerAccountContext.mockResolvedValue({
      id: BigInt(1),
      account_type: 'SELLER',
      status: 'ACTIVE',
      store: { id: BigInt(100) },
    } as never);

    orderRepo.findOrderDetailByStore.mockResolvedValue({
      id: BigInt(10),
      status: OrderStatus.SUBMITTED,
      order_number: 'O-1',
      account_id: BigInt(20),
      pickup_at: new Date(),
      buyer_name: '홍길동',
      buyer_phone: '010-0000-0000',
      subtotal_price: 1000,
      discount_price: 0,
      total_price: 1000,
      submitted_at: new Date(),
      confirmed_at: null,
      made_at: null,
      picked_up_at: null,
      canceled_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      status_histories: [],
      items: [],
    } as never);

    await expect(
      service.sellerUpdateOrderStatus(BigInt(1), {
        orderId: '10',
        toStatus: 'MADE',
        note: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('주문이 없으면 NotFoundException을 던져야 한다', async () => {
    repo.findSellerAccountContext.mockResolvedValue({
      id: BigInt(1),
      account_type: 'SELLER',
      status: 'ACTIVE',
      store: { id: BigInt(100) },
    } as never);

    orderRepo.findOrderDetailByStore.mockResolvedValue(null);

    await expect(service.sellerOrder(BigInt(1), BigInt(9999))).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── 성공 경로 테스트 ────────────────────────────────────────

  describe('sellerOrderList', () => {
    it('주문 목록을 커서 기반 페이지네이션으로 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      const orderRows = [
        {
          id: BigInt(10),
          order_number: 'ORD-001',
          status: OrderStatus.SUBMITTED,
          pickup_at: NOW,
          buyer_name: '홍길동',
          buyer_phone: '010-1234-5678',
          total_price: 15000,
          created_at: NOW,
        },
        {
          id: BigInt(9),
          order_number: 'ORD-002',
          status: OrderStatus.CONFIRMED,
          pickup_at: NOW,
          buyer_name: '김철수',
          buyer_phone: '010-9876-5432',
          total_price: 25000,
          created_at: NOW,
        },
      ];
      orderRepo.listOrdersByStore.mockResolvedValue(orderRows as never);

      const result = await service.sellerOrderList(BigInt(1));

      expect(orderRepo.listOrdersByStore).toHaveBeenCalledWith({
        storeId: BigInt(100),
        limit: 20,
      });
      expect(result).toEqual({
        items: [
          {
            id: '10',
            orderNumber: 'ORD-001',
            status: OrderStatus.SUBMITTED,
            pickupAt: NOW,
            buyerName: '홍길동',
            buyerPhone: '010-1234-5678',
            totalPrice: 15000,
            createdAt: NOW,
          },
          {
            id: '9',
            orderNumber: 'ORD-002',
            status: OrderStatus.CONFIRMED,
            pickupAt: NOW,
            buyerName: '김철수',
            buyerPhone: '010-9876-5432',
            totalPrice: 25000,
            createdAt: NOW,
          },
        ],
        nextCursor: null,
      });
    });

    it('status 필터를 적용하여 주문 목록을 조회해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);
      orderRepo.listOrdersByStore.mockResolvedValue([] as never);

      await service.sellerOrderList(BigInt(1), {
        status: 'SUBMITTED',
      });

      expect(orderRepo.listOrdersByStore).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: BigInt(100),
          status: OrderStatus.SUBMITTED,
        }),
      );
    });
  });

  describe('sellerOrder', () => {
    it('주문 상세 정보를 반환해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      const orderDetailRow = {
        id: BigInt(10),
        order_number: 'ORD-001',
        account_id: BigInt(20),
        status: OrderStatus.CONFIRMED,
        pickup_at: NOW,
        buyer_name: '홍길동',
        buyer_phone: '010-1234-5678',
        subtotal_price: 15000,
        discount_price: 1000,
        total_price: 14000,
        submitted_at: NOW,
        confirmed_at: NOW,
        made_at: null,
        picked_up_at: null,
        canceled_at: null,
        created_at: NOW,
        updated_at: NOW,
        status_histories: [
          {
            id: BigInt(1),
            from_status: OrderStatus.SUBMITTED,
            to_status: OrderStatus.CONFIRMED,
            changed_at: NOW,
            note: null,
          },
        ],
        items: [
          {
            id: BigInt(50),
            store_id: BigInt(100),
            product_id: BigInt(200),
            product_name_snapshot: '케이크',
            regular_price_snapshot: 15000,
            sale_price_snapshot: null,
            quantity: 1,
            item_subtotal_price: 15000,
            option_items: [
              {
                id: BigInt(60),
                group_name_snapshot: '사이즈',
                option_title_snapshot: '라지',
                option_price_delta_snapshot: 3000,
              },
            ],
            custom_texts: [
              {
                id: BigInt(70),
                token_key_snapshot: 'message',
                default_text_snapshot: '축하합니다',
                value_text: '생일 축하해요!',
                sort_order: 0,
              },
            ],
            free_edits: [
              {
                id: BigInt(80),
                crop_image_url: 'https://img.example.com/crop.png',
                description_text: '자유 편집',
                sort_order: 0,
                attachments: [
                  {
                    id: BigInt(90),
                    image_url: 'https://img.example.com/attach.png',
                    sort_order: 0,
                  },
                ],
              },
            ],
          },
        ],
      };
      orderRepo.findOrderDetailByStore.mockResolvedValue(
        orderDetailRow as never,
      );

      const result = await service.sellerOrder(BigInt(1), BigInt(10));

      expect(orderRepo.findOrderDetailByStore).toHaveBeenCalledWith({
        orderId: BigInt(10),
        storeId: BigInt(100),
      });
      expect(result).toEqual({
        id: '10',
        orderNumber: 'ORD-001',
        accountId: '20',
        status: OrderStatus.CONFIRMED,
        pickupAt: NOW,
        buyerName: '홍길동',
        buyerPhone: '010-1234-5678',
        subtotalPrice: 15000,
        discountPrice: 1000,
        totalPrice: 14000,
        submittedAt: NOW,
        confirmedAt: NOW,
        madeAt: null,
        pickedUpAt: null,
        canceledAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        statusHistories: [
          {
            id: '1',
            fromStatus: OrderStatus.SUBMITTED,
            toStatus: OrderStatus.CONFIRMED,
            changedAt: NOW,
            note: null,
          },
        ],
        items: [
          {
            id: '50',
            storeId: '100',
            productId: '200',
            productNameSnapshot: '케이크',
            regularPriceSnapshot: 15000,
            salePriceSnapshot: null,
            quantity: 1,
            itemSubtotalPrice: 15000,
            optionItems: [
              {
                id: '60',
                groupNameSnapshot: '사이즈',
                optionTitleSnapshot: '라지',
                optionPriceDeltaSnapshot: 3000,
              },
            ],
            customTexts: [
              {
                id: '70',
                tokenKeySnapshot: 'message',
                defaultTextSnapshot: '축하합니다',
                valueText: '생일 축하해요!',
                sortOrder: 0,
              },
            ],
            freeEdits: [
              {
                id: '80',
                cropImageUrl: 'https://img.example.com/crop.png',
                descriptionText: '자유 편집',
                sortOrder: 0,
                attachments: [
                  {
                    id: '90',
                    imageUrl: 'https://img.example.com/attach.png',
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  describe('sellerUpdateOrderStatus', () => {
    it('유효한 상태 전이로 주문 상태를 변경해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      const currentOrder = {
        id: BigInt(10),
        order_number: 'ORD-001',
        account_id: BigInt(20),
        status: OrderStatus.SUBMITTED,
        pickup_at: NOW,
        buyer_name: '홍길동',
        buyer_phone: '010-1234-5678',
        subtotal_price: 15000,
        discount_price: 0,
        total_price: 15000,
        submitted_at: NOW,
        confirmed_at: null,
        made_at: null,
        picked_up_at: null,
        canceled_at: null,
        created_at: NOW,
        updated_at: NOW,
        status_histories: [],
        items: [],
      };
      orderRepo.findOrderDetailByStore.mockResolvedValue(currentOrder as never);

      const updatedOrder = {
        id: BigInt(10),
        order_number: 'ORD-001',
        status: OrderStatus.CONFIRMED,
        pickup_at: NOW,
        buyer_name: '홍길동',
        buyer_phone: '010-1234-5678',
        total_price: 15000,
        created_at: NOW,
      };
      orderRepo.updateOrderStatusBySeller.mockResolvedValue(
        updatedOrder as never,
      );

      const result = await service.sellerUpdateOrderStatus(BigInt(1), {
        orderId: '10',
        toStatus: 'CONFIRMED',
      });

      expect(orderRepo.findOrderDetailByStore).toHaveBeenCalledWith({
        orderId: BigInt(10),
        storeId: BigInt(100),
      });
      expect(orderRepo.updateOrderStatusBySeller).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: BigInt(10),
          storeId: BigInt(100),
          actorAccountId: BigInt(1),
          toStatus: OrderStatus.CONFIRMED,
          note: null,
        }),
      );
      expect(result).toEqual({
        id: '10',
        orderNumber: 'ORD-001',
        status: OrderStatus.CONFIRMED,
        pickupAt: NOW,
        buyerName: '홍길동',
        buyerPhone: '010-1234-5678',
        totalPrice: 15000,
        createdAt: NOW,
      });
    });

    it('취소 시 사유 노트와 함께 상태를 변경해야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(SELLER_CONTEXT as never);

      const currentOrder = {
        id: BigInt(10),
        order_number: 'ORD-001',
        account_id: BigInt(20),
        status: OrderStatus.SUBMITTED,
        pickup_at: NOW,
        buyer_name: '홍길동',
        buyer_phone: '010-1234-5678',
        subtotal_price: 15000,
        discount_price: 0,
        total_price: 15000,
        submitted_at: NOW,
        confirmed_at: null,
        made_at: null,
        picked_up_at: null,
        canceled_at: null,
        created_at: NOW,
        updated_at: NOW,
        status_histories: [],
        items: [],
      };
      orderRepo.findOrderDetailByStore.mockResolvedValue(currentOrder as never);

      const updatedOrder = {
        id: BigInt(10),
        order_number: 'ORD-001',
        status: OrderStatus.CANCELED,
        pickup_at: NOW,
        buyer_name: '홍길동',
        buyer_phone: '010-1234-5678',
        total_price: 15000,
        created_at: NOW,
      };
      orderRepo.updateOrderStatusBySeller.mockResolvedValue(
        updatedOrder as never,
      );

      const result = await service.sellerUpdateOrderStatus(BigInt(1), {
        orderId: '10',
        toStatus: 'CANCELED',
        note: '재고 부족',
      });

      expect(orderRepo.updateOrderStatusBySeller).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: BigInt(10),
          toStatus: OrderStatus.CANCELED,
          note: '재고 부족',
        }),
      );
      expect(result.status).toBe(OrderStatus.CANCELED);
    });
  });
});
