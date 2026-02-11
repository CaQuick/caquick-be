import { Test, TestingModule } from '@nestjs/testing';

import { SellerService } from '../seller.service';

import { SellerContentMutationResolver } from './seller-content-mutation.resolver';
import { SellerProductQueryResolver } from './seller-product-query.resolver';

describe('SellerResolvers', () => {
  let queryResolver: SellerProductQueryResolver;
  let mutationResolver: SellerContentMutationResolver;
  let service: jest.Mocked<SellerService>;

  beforeEach(async () => {
    service = {
      sellerProduct: jest.fn(),
      sellerDeleteBanner: jest.fn(),
    } as unknown as jest.Mocked<SellerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerProductQueryResolver,
        SellerContentMutationResolver,
        {
          provide: SellerService,
          useValue: service,
        },
      ],
    }).compile();

    queryResolver = module.get<SellerProductQueryResolver>(
      SellerProductQueryResolver,
    );
    mutationResolver = module.get<SellerContentMutationResolver>(
      SellerContentMutationResolver,
    );
  });

  it('sellerProduct는 productId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '11' };

    await queryResolver.sellerProduct(user, '123');

    expect(service.sellerProduct).toHaveBeenCalledWith(BigInt(11), BigInt(123));
  });

  it('sellerDeleteBanner는 bannerId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '11' };

    await mutationResolver.sellerDeleteBanner(user, '77');

    expect(service.sellerDeleteBanner).toHaveBeenCalledWith(
      BigInt(11),
      BigInt(77),
    );
  });
});
