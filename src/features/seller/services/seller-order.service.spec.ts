import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';

import { OrderStatusPolicy } from '../../order/policies/order-status.policy';
import { OrderRepository } from '../../order/repositories/order.repository';
import { SellerRepository } from '../repositories/seller.repository';

import { SellerOrderService } from './seller-order.service';

describe('SellerOrderService', () => {
  let service: SellerOrderService;
  let repo: jest.Mocked<SellerRepository>;
  let orderRepo: jest.Mocked<OrderRepository>;

  beforeEach(async () => {
    repo = {
      findSellerAccountContext: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;
    orderRepo = {
      findOrderDetailByStore: jest.fn(),
      updateOrderStatusBySeller: jest.fn(),
    } as unknown as jest.Mocked<OrderRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerOrderService,
        OrderStatusPolicy,
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
});
