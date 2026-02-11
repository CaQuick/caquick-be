import { Test, TestingModule } from '@nestjs/testing';

import { SellerService } from './seller.service';
import { SellerContentService } from './services/seller-content.service';
import { SellerConversationService } from './services/seller-conversation.service';
import { SellerOrderService } from './services/seller-order.service';
import { SellerProductService } from './services/seller-product.service';
import { SellerStoreService } from './services/seller-store.service';

describe('SellerService', () => {
  let service: SellerService;
  let storeService: jest.Mocked<SellerStoreService>;
  let orderService: jest.Mocked<SellerOrderService>;

  beforeEach(async () => {
    storeService = {
      sellerMyStore: jest.fn(),
    } as unknown as jest.Mocked<SellerStoreService>;

    orderService = {
      sellerUpdateOrderStatus: jest.fn(),
    } as unknown as jest.Mocked<SellerOrderService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerService,
        {
          provide: SellerStoreService,
          useValue: storeService,
        },
        {
          provide: SellerProductService,
          useValue: {},
        },
        {
          provide: SellerOrderService,
          useValue: orderService,
        },
        {
          provide: SellerConversationService,
          useValue: {},
        },
        {
          provide: SellerContentService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<SellerService>(SellerService);
  });

  it('sellerMyStore는 storeService로 위임해야 한다', async () => {
    await service.sellerMyStore(BigInt(11));

    expect(storeService.sellerMyStore).toHaveBeenCalledWith(BigInt(11));
  });

  it('sellerUpdateOrderStatus는 orderService로 위임해야 한다', async () => {
    await service.sellerUpdateOrderStatus(BigInt(11), {
      orderId: '1',
      toStatus: 'CONFIRMED',
      note: null,
    });

    expect(orderService.sellerUpdateOrderStatus).toHaveBeenCalledWith(
      BigInt(11),
      {
        orderId: '1',
        toStatus: 'CONFIRMED',
        note: null,
      },
    );
  });
});
